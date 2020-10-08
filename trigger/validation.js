const nameRegex = new RegExp("^[0-9A-Za-z_.-]+$");
const triggerTypeRegex = new RegExp("^[0-9A-Za-z]+$");



function validateTrigger(trigger) {
    _validateString(trigger.name,200, true, "name", nameRegex);
    _validateString(trigger.type, 32, true, "type", triggerTypeRegex);
    _validateString(trigger.object_guid, 32, false, "object_guid");
    _validateString(trigger.object_key, 200, false, "object_key");
    _validateString(trigger.shard_id, 32, false, "shard_id");
    _validateString(trigger.data_source, 1000, true, "data_source");
    _validateString(trigger.data_source_type, 1000, true, "data_source_type");
    _validateObject(trigger.data_source_variable, "data_source_variable");
    _validateString(trigger.variable_1, 200, true, "variable_1");
    _validateString(trigger.variable_2, 200, true, "variable_2");
    _validateString(trigger.variable_operator, 40, true, "variable_operator");
    _validateAllowAdhoc(trigger.allow_adhoc);
}


function _validateAllowAdhoc(allowAdhoc) {
    if (allowAdhoc === undefined || allowAdhoc === null) {
        return;
    }

    if (!(typeof allowAdhoc === 'boolean' || allowAdhoc instanceof Boolean)) {
        throw Error("Allow adhoc must be boolean");
    }
}

function _validateObject(o, requiredFields, fieldName) {
    if (!(o instanceof Object)) {
        throw Error(`${fieldName} must be object`);
    }
}


function validateTriggerAction(triggerAction) {
    _validateString(triggerAction.name, 200, true, "name");
    _validateTriggerActionPriority(triggerAction.priority);
}

function _validateString(s, length, necessary, fieldName, regex) {
    if (necessary && (!(s))) {
        throw Error(`${fieldName} is necessary but not set`)
    }

    if (!(necessary) && (!(s))) {
        return;
    }

    if (!(typeof s === 'string' || s instanceof String)) {
        throw Error(`${fieldName} must be string`);
    }

    if (s.length > length) {
        throw Error(`${fieldName} cannot be longer than 32 characters`)
    }

    if (regex !== undefined) {
        if (!(regex.test(s))) {
            throw Error(`${fieldName} contains invalid characters`);
        }
    }
}

function _validateTriggerActionPriority(priority) {
    if (!(typeof priority === 'number' || priority instanceof Number)) {
        throw Error('priority must be integer')
    }
}

exports.validateTrigger = validateTrigger;
exports.validateTriggerAction = validateTriggerAction;
