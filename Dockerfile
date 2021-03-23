FROM node:12.21
ADD . api-spec-converter/
RUN cd api-spec-converter && npm install
RUN npm i -g ./api-spec-converter

CMD [ "node", "api-spec-converter" ]