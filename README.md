# api-spec-converter adapted to 4th platform Swagger
Convert between API description formats such as [Swagger](http://swagger.io/) and [RAML](http://raml.org/)

**Currently only supports conversion to OpenAPI(fka Swagger) 2.0 format, and from OpenAPI 2.0 to OpenAPI 3.0.x**

Conversion to OpenAPI 2.0 (Swagger) from OpenAPI 3.0 is done with several considerations to make it compatible with 4th platform swagger guidelines.

## Installation

### Command Line
```bash
npm i -g .
```

## Usage

### Command Line
```bash
$ api-spec-converter -h

  Usage: api-spec-converter [options] <URL|filename>

  Convert API descriptions between popular formats.

  Supported formats:
    * swagger_1
    * swagger_2
    * openapi_3
    * api_blueprint
    * io_docs
    * google
    * raml
    * wadl

  Options:

    -h, --help              output usage information
    -V, --version           output the version number
    -f, --from <format>     Specifies format to convert
    -t, --to <format>       Specifies output format
    -s, --syntax [syntax]   Specifies output data syntax: json or yaml. Defaults to json
    -o, --order [sortOrder] Specifies top fields ordering: openapi or alpha. Defaults to openapi
    -c, --check             Check if result is valid spec
    -d, --dummy             Fill missing required fields with dummy data
```

Example:
```bash
$ api-spec-converter --from=swagger_1 --to=swagger_2 --syntax=yaml --order=alpha https://raw.githubusercontent.com/LucyBot-Inc/api-spec-converter/master/test/input/swagger_1/petstore/pet.json > swagger.json
```

## Supported Formats

* [Swagger 1.x](https://github.com/OAI/OpenAPI-Specification/blob/master/versions/1.2.md) (swagger_1)
* [OpenAPI(fka Swagger) 2.0](https://github.com/OAI/OpenAPI-Specification/blob/master/versions/2.0.md) (swagger_2)
* [OpenAPI 3.0.x](https://github.com/OAI/OpenAPI-Specification/blob/master/versions/3.0.0.md) (openapi_3)
* [I/O Docs](https://github.com/mashery/iodocs) (io_docs)
* [API Blueprint](https://github.com/apiaryio/api-blueprint/blob/master/API%20Blueprint%20Specification.md) (api_blueprint)
* [Google API Discovery](https://developers.google.com/discovery/v1/reference/apis) (google)
* [RAML](http://raml.org/spec.html) (raml)
* [WADL](http://www.w3.org/Submission/wadl/) (wadl)


## Conversion Table

|from:             |swagger_1|swagger_2|openapi_3|io_docs|api_blueprint|google|raml|wadl|
-------------------|:-------:|:-------:|:-----:|:-----:|:-----------:|:----:|:--:|:--:|
|to swagger_1      |  n/a    |         |       |       |             |      |    |    |
|to swagger_2      | :white_check_mark: |    n/a  | :white_check_mark:  | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
|to openapi_3      |   :eight_spoked_asterisk:     | :white_check_mark: |  n/a  |   :eight_spoked_asterisk:  | :eight_spoked_asterisk: |  :eight_spoked_asterisk:   | :eight_spoked_asterisk:  | :eight_spoked_asterisk:  |
|to io_docs        |         |         |       |  n/a  |             |      |    |    |
|to api_blueprint  |         |         |       |       |    n/a      |      |    |    |
|to google         |         |         |       |       |             |  n/a |    |    |
|to raml           |         |         |       |       |             |      | n/a|    |
|to wadl           |         |         |       |       |             |      |    | n/a|

#### Key
* :white_check_mark: - direct conversion
* :eight_spoked_asterisk: - conversion via swagger_2

## Contributing
Contributions are welcome and encouraged.

### Testing
Please add a test case if you're adding features or fixing bugs. To run the tests:

```bash
npm test
```

In case you need to override the expected outputs, due to a justified and verified change, run this:
```bash
WRITE_GOLDEN=true npm test
```
### Releases
```
npm run browserify
git commit -a -m "Build browser distribution"
npm version minor # or major/patch
npm publish
git push --follow-tags
```
