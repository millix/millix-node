export function orElsePromise(object, fn) {
    return object ? Promise.resolve(object) : fn();
}

export default {
    orElsePromise
};
