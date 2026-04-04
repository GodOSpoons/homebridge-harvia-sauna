"use strict";
const HarviaPlatform_1 = require("./HarviaPlatform");
module.exports = (api) => {
    api.registerPlatform('homebridge-harvia', 'HarviaSauna', HarviaPlatform_1.HarviaPlatform);
};
