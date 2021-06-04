"use strict";
const cloneDeep = require('lodash.clonedeep');

var HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'],
    SCHEMA_PROPERTIES = ['format', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'multipleOf', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties', 'additionalProperties', 'pattern', 'enum', 'default'],
    ARRAY_PROPERTIES = ['type', 'items'];

var APPLICATION_JSON_REGEX = /^(application\/json|[^;\/ \t]+\/[^;\/ \t]+[+]json)[ \t]*(;.*)?$/;
var SUPPORTED_MIME_TYPES = {
    APPLICATION_X_WWW_URLENCODED: 'application/x-www-form-urlencoded',
    MULTIPART_FORM_DATA: 'multipart/form-data'
};

var npath = require('path');
var fs = require('fs');
var urlParser = require('url');
var YAML = require('js-yaml');

/**
 * Transforms OpenApi 3.0 to Swagger 2
 */
var Converter = module.exports = function(data) {
  this.spec = JSON.parse(JSON.stringify(data.spec));
  if (data.source && !data.source.startsWith('http')) {
    this.directory = npath.dirname(data.source);
  }
}

Converter.prototype.convert = function() {
  this.spec.swagger = '2.0';

  this.spec.consumes = ["application/json"];
  this.spec.produces = ["application/json"];

  this.convertInfos();
  this.convertOperations();
  if (this.spec.components) {
    this.convertSchemas();
    this.convertSecurityDefinitions();
    this.convertParameters();

    var responses = this.spec.components.responses;
    if (responses) {
        for (var key in responses) {
            this.convertResponse(responses[key]);
        }
    }
    this.spec.responses = responses;
    delete this.spec.components;

    fixRefs(this.spec);
  }
  return this.spec;
}

Converter.prototype.convertParameters = function() {
    var parameters = this.spec.components.parameters;
    if (parameters) {
        delete parameters["x-token-info"];
    }
    for (var key in parameters) {
        var parameter = parameters[key];
        if (parameter.schema) {
            this.convertSchema(parameter.schema)
            var schema = parameter.schema;
            delete parameter.schema;
            parameter = {...schema, ...parameter};
            parameters[key] = parameter;
        }
    }
    this.spec.parameters = parameters;
}

function fixRef(ref) {
  return ref
      .replace('#/components/schemas/', '#/definitions/')
}

function fixRefs(obj) {
  if (Array.isArray(obj)) {
    obj.forEach(fixRefs);
  } else if (typeof obj === 'object') {
    for (var key in obj) {
      if (key === '$ref') {
        obj.$ref = fixRef(obj.$ref);
      } else {
        fixRefs(obj[key]);
      }
    }
  }
}

Converter.prototype.resolveReference = function(base, obj, shouldClone, shouldInline) {
  if (!obj || !obj.$ref) return obj;
  var ref = obj.$ref;
  if (ref.startsWith('#')) {
    if (shouldInline) {
        var keys = ref.split('/').map(k => k.replace(/~1/g, '/').replace(/~0/g, '~'));
        keys.shift();
        var cur = base;
        keys.forEach(function(k) { cur = cur[k] });
        return shouldClone ? cloneDeep(cur) : cur;
    } else {
        return { $ref: ref.replace("components/", "") };
    }
  } else if (ref.startsWith('http') || !this.directory) {
    return obj;
  } else {
    var res = ref.split('#/', 2);
    let content = fs.readFileSync(npath.join(this.directory, res[0]), 'utf8');
    let external = null;
    try {
      external = JSON.parse(content);
    } catch (e) {
      try {
        external = YAML.safeLoad(content);
      } catch (e) {
        throw new Error("Could not parse path of $ref " + res[0] + " as JSON or YAML");
      }
    }
    if (res.length > 1) {
      var keys = res[1].split('/').map(k => k.replace(/~1/g, '/').replace(/~0/g, '~'));
      keys.forEach(function(k) { external = external[k] });
    }
    return external;
  }
}

/**
 * convert main infos and tags
 */
Converter.prototype.convertInfos = function() {
    var server = this.spec.servers && this.spec.servers[1];
    if (server) {
        var serverUrl = server.url,
            variables = server['variables'] || {};
        for (var variable in variables) {
            var variableObject = variables[variable] || {};
            if (variableObject['default']) {
                var re = RegExp('{' + variable + '}', 'g');
                serverUrl = serverUrl.replace(re, variableObject['default']);
            }
        }
        var url = urlParser.parse(serverUrl);
        if (url.host == null) {
            delete this.spec.host;
        } else {
            this.spec.host = url.host;
        }
        if (url.protocol == null) {
            delete this.spec.schemes;
        } else {
            this.spec.schemes = [url.protocol.substring(0, url.protocol.length - 1)];  // strip off trailing colon
        }
        this.spec.opBasePath = url.pathname + "/";
        this.spec.basePath = url.pathname;
    }
    delete this.spec.servers;
    delete this.spec.openapi;
    delete this.spec.security;
}

Converter.prototype.convertOperations = function() {
    var path, pathObject, method, operation;
    var newPaths = {};
    for (path in this.spec.paths) {
        pathObject = this.spec.paths[path] = this.resolveReference(this.spec, this.spec.paths[path], true, false);
        this.convertOperationParameters(pathObject); // converts common parameters
        for (method in pathObject) {
            if (HTTP_METHODS.indexOf(method) >= 0) {
                operation = pathObject[method] = this.resolveReference(this.spec, pathObject[method], true, false);
                this.convertOperationParameters(operation);
                this.convertResponses(operation);
            }
        }
        newPaths[path.replace(this.spec.opBasePath, "/")] = pathObject;
    }
    this.spec.paths = newPaths;
    delete this.spec.opBasePath;
}

Converter.prototype.convertOperationParameters = function(operation) {
    var content, param, contentKey, mediaRanges, mediaTypes;
    var parameters = operation.parameters || [];
    operation.parameters = parameters.filter(p => {
        var ref = p.$ref || "";
        return !ref.endsWith("x-token-info");
    });
    
    if (operation.requestBody) {
        param = this.resolveReference(this.spec, operation.requestBody, true, false);

        // fixing external $ref in body
        if (operation.requestBody.content) {
            var type = getSupportedMimeTypes(operation.requestBody.content)[0];
            var structuredObj = {'content': {}};
            let data = operation.requestBody.content[type];

            if (data && data.schema && data.schema.$ref && !data.schema.$ref.startsWith('#')) {
                param = this.resolveReference(this.spec, data.schema, true, false);
                structuredObj['content'][`${type}`] = {'schema': param};
                param = structuredObj
            }
        }

        param.name = 'body';
        content = param.content;
        if (content && Object.keys(content).length) {
            mediaRanges = Object.keys(content)
                .filter(mediaRange => mediaRange.indexOf('/') > 0);
            mediaTypes = mediaRanges.filter(range => range.indexOf('*') < 0);
            contentKey = getSupportedMimeTypes(content)[0];
            delete param.content;

            if (contentKey === SUPPORTED_MIME_TYPES.APPLICATION_X_WWW_URLENCODED
                || contentKey === SUPPORTED_MIME_TYPES.MULTIPART_FORM_DATA) {
                operation.consumes = mediaTypes;
                param.in = 'formData';
                param.schema = content[contentKey].schema;
                param.schema = this.resolveReference(this.spec, param.schema, true, false);
                if (param.schema.type === 'object' && param.schema.properties) {
                    const required = param.schema.required || [];
                    for (var name in param.schema.properties) {
                        const schema = param.schema.properties[name];
                        // readOnly properties should not be sent in requests
                        if (!schema.readOnly) {
                            const formDataParam = {
                                name,
                                in: 'formData',
                                schema,
                            };
                            if (required.indexOf(name) >= 0) {
                                formDataParam.required = true;
                            }
                            operation.parameters.push(formDataParam);
                        }
                    }
                } else {
                    operation.parameters.push(param);
                }
            } else if (contentKey) {
                param.in = 'body';
                param.schema = content[contentKey].schema;
                operation.parameters.push(param);
            } else if (mediaRanges) {
                operation.consumes = mediaTypes || ['application/octet-stream'];
                param.in = 'body';
                param.name = param.name || 'file';
                delete param.type;
                param.schema = content[mediaRanges[0]].schema || {
                    type: 'string',
                    format: 'binary'
                };
                operation.parameters.push(param);
            }

            if (param.schema) {
                this.convertSchema(param.schema, 'request');
            }
        }
        delete operation.requestBody;
    }
    this.convertOperationParameters(operation);
}

Converter.prototype.convertOperationParameters = function(obj) {
    var param;

    if (obj.parameters === undefined) {
        return;
    }

    obj.parameters = obj.parameters || [];

    (obj.parameters || []).forEach((param, i) => {
        param = obj.parameters[i] = this.resolveReference(this.spec, param, false, false);
        if (param.in !== 'body') {
            this.copySchemaProperties(param, SCHEMA_PROPERTIES);
            this.copySchemaProperties(param, ARRAY_PROPERTIES);
            this.copySchemaXProperties(param);
            if (!param.description) {
                const schema = this.resolveReference(this.spec, param.schema, false, false);
                if (!!schema && schema.description) {
                    param.description = schema.description;
                }
            }
            delete param.schema;
            delete param.allowReserved;
            if (param.example !== undefined) {
                param['x-example'] = param.example;
            }
            delete param.example;
        }
        if (param.type === 'array') {
          let style = param.style || (param.in === 'query' || param.in === 'cookie' ? 'form' : 'simple');
          if (style === 'matrix') {
            param.collectionFormat = param.explode ? undefined : 'csv';
          } else if (style === 'label') {
            param.collectionFormat = undefined;
          } else if (style === 'simple') {
            param.collectionFormat = 'csv';
          } else if (style === 'spaceDelimited') {
            param.collectionFormat = 'ssv';
          } else if (style === 'pipeDelimited') {
            param.collectionFormat = 'pipes';
          } else if (style === 'deepOpbject') {
            param.collectionFormat = 'multi';
          } else if (style === 'form') {
            param.collectionFormat = param.explode === false ? 'csv' : 'multi';
          }
        }
        delete param.style;
        delete param.explode;
    });
}

Converter.prototype.copySchemaProperties = function(obj, props) {
    let schema = this.resolveReference(this.spec, obj.schema, true, false);
    if (!schema) return;
    props.forEach(function(prop) {
        var value = schema[prop];

        switch (prop) {
            case 'additionalProperties':
                if (typeof value === 'boolean') return;
        }

        if (value !== undefined) {
            obj[prop] = value;
        }
    });
}

Converter.prototype.copySchemaXProperties = function(obj) {
    let schema = this.resolveReference(this.spec, obj.schema, true, false);
    if (!schema) return;
    for (const propName in schema) {
        if (hasOwnProperty.call(schema, propName)
            && !hasOwnProperty.call(obj, propName)
            && propName.startsWith('x-')) {
            obj[propName] = schema[propName];
        }
    }
};

Converter.prototype.convertResponses = function(operation) {
    var code, response;
    for (code in operation.responses) {
        response = operation.responses[code] = this.resolveReference(this.spec, operation.responses[code], true, false);
        this.convertResponse(response)
    }
}

Converter.prototype.convertResponse = function(response) {
    var anySchema, content, jsonSchema, mediaRange, mediaType, response, resolved, headers;
    if (response.content) {
        anySchema = jsonSchema = null;
        for (mediaRange in response.content) {
            // produces and examples only allow media types, not ranges
            // use application/octet-stream as a catch-all type
            mediaType = mediaRange.indexOf('*') < 0 ? mediaRange
                : 'application/octet-stream';

            content = response.content[mediaRange];

            anySchema = anySchema || content.schema;
            if (!jsonSchema && isJsonMimeType(mediaType)) {
                jsonSchema = content.schema;
            }

            if (content.example) {
                response.examples = response.examples || {};
                response.examples[mediaType] = content.example;
            }
        }

        if (anySchema) {
            response.schema = jsonSchema || anySchema;
            resolved = this.resolveReference(this.spec, response.schema, true, false);
            if (resolved
                && response.schema.$ref
                && !response.schema.$ref.startsWith('#')) {
                response.schema = resolved;
            }

            this.convertSchema(response.schema, 'response');
        }
    }

    headers = response.headers;
    if (headers) {
        for (var header in headers) {
            // Always resolve headers when converting to v2.
            resolved = this.resolveReference(this.spec, headers[header], true, true)
            // Headers should be converted like parameters.
            if (resolved.schema){
                resolved.type = resolved.schema.type
                resolved.format = resolved.schema.format
                delete resolved.schema
            }
            headers[header] = resolved;
        }
    }

    delete response.content;
}

Converter.prototype.convertSchema = function(def, operationDirection) {
    if (def.oneOf) {
        delete def.oneOf;

        if (def.discriminator) {
            delete def.discriminator;
        }
    }

    if (def.anyOf) {
        delete def.anyOf;

        if (def.discriminator) {
            delete def.discriminator;
        }
    }

    if (def.allOf) {
        for (var i in def.allOf) {
            this.convertSchema(def.allOf[i], operationDirection);
        }
    }

    if (def.discriminator) {
        if (def.discriminator.mapping) {
            this.convertDiscriminatorMapping(def.discriminator.mapping);
        }

        def.discriminator = def.discriminator.propertyName;
    }

    switch (def.type) {
    case 'object':
        if (def.properties) {
            for (var propName in def.properties) {
                if (def.properties[propName].writeOnly === true && operationDirection === 'response') {
                    delete def.properties[propName];
                } else {
                    this.convertSchema(def.properties[propName], operationDirection);
                    delete def.properties[propName].writeOnly;
                }
            }
        }
    case 'array':
        if (def.items) {
            this.convertSchema(def.items, operationDirection);
        }
    }

    if (def.nullable) {
        def['x-nullable'] = true;
        delete def.nullable;
    }

    // OpenAPI 3 has boolean "deprecated" on Schema, OpenAPI 2 does not
    // Convert to x-deprecated for Autorest (and perhaps others)
    if (def['deprecated'] !== undefined) {
        // Move to x-deprecated, unless it is already defined
        if (def['x-deprecated'] === undefined) {
            def['x-deprecated'] = def.deprecated;
        }
        delete def.deprecated;
    }
}

Converter.prototype.convertSchemas = function() {
    this.spec.definitions = this.spec.components.schemas;

    for (var defName in this.spec.definitions) {
        this.convertSchema(this.spec.definitions[defName]);
    }

    delete this.spec.components.schemas;
}

Converter.prototype.convertDiscriminatorMapping = function(mapping) {
    for (const payload in mapping) {
        const schemaNameOrRef = mapping[payload];
        if (typeof schemaNameOrRef !== 'string') {
            console.warn(`Ignoring ${schemaNameOrRef} for ${payload} in discriminator.mapping.`);
            continue;
        }

        // payload may be a schema name or JSON Reference string.
        // OAS3 spec limits schema names to ^[a-zA-Z0-9._-]+$
        // Note: Valid schema name could be JSON file name without extension.
        //       Prefer schema name, with file name as fallback.
        let schema;
        if (/^[a-zA-Z0-9._-]+$/.test(schemaNameOrRef)) {
            try {
                schema = this.resolveReference(
                    this.spec,
                    {$ref: `#/components/schemas/${schemaNameOrRef}`},
                    false,
                    false
                );
            } catch (err) {
                console.debug(
                    `Error resolving ${schemaNameOrRef} for ${payload
                    } as schema name in discriminator.mapping: ${err}`
                );
            }
        }

        // schemaNameRef is not a schema name.  Try to resolve as JSON Ref.
        if (!schema) {
            try {
                schema = this.resolveReference(
                    this.spec,
                    {$ref: schemaNameOrRef},
                    false,
                    false
                );
            } catch (err) {
                console.debug(
                    `Error resolving ${schemaNameOrRef} for ${payload
                    } in discriminator.mapping: ${err}`
                );
            }
        }

        if (schema) {
            // Swagger Codegen + OpenAPI Generator extension
            // https://github.com/swagger-api/swagger-codegen/pull/4252
            schema['x-discriminator-value'] = payload;

            // AutoRest extension
            // https://github.com/Azure/autorest/pull/474
            schema['x-ms-discriminator-value'] = payload;
        } else {
            console.warn(`Unable to resolve ${schemaNameOrRef} for ${payload} in discriminator.mapping.`);
        }
    }
}

Converter.prototype.convertSecurityDefinitions = function() {
    delete this.spec.components.securitySchemes;
}

function isJsonMimeType(type) {
    return new RegExp(APPLICATION_JSON_REGEX, 'i').test(type);
}

function getSupportedMimeTypes(content) {
    var MIME_VALUES = Object.keys(SUPPORTED_MIME_TYPES).map((key) => { return SUPPORTED_MIME_TYPES[key] });
    return Object.keys(content).filter(key => {
        return MIME_VALUES.indexOf(key) > -1 || isJsonMimeType(key);
    });
}
