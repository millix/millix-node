export function orElsePromise(object, fn) {
    return object ? Promise.resolve(object) : fn();
}


export class NodeVersion {
    constructor(major, minor, patch) {
        this.major = major;
        this.minor = minor;
        this.patch = patch;
    }

    static fromString(version) {
        const re = new RegExp('(?<major>\\d+)\\.(?<minor>\\d+)\\.(?<patch>\\d+)');
        let major, minor, patch;
        if (version) {
            const match = re.exec(version);
            if (match && match.groups &&
                match.groups.major && match.groups.minor && match.groups.patch) {
                try {
                    major = parseInt(match.groups.major);
                    minor = parseInt(match.groups.minor);
                    patch = parseInt(match.groups.patch);
                    return new NodeVersion(major, minor, patch);
                }
                catch (ignore) {
                }
            }
        }
        return null;
    }

    static ofNullable(version) {
        if (!version) {
            return new NodeVersion(0, 0, 0);
        }
        return version;
    }

    compareTo(other) {
        if (this.major === other.major && this.minor === other.minor && this.patch === other.patch) {
            return 0;
        }

        if (this.major > other.major || this.major === other.major && this.minor > other.minor || this.major === other.major && this.minor === other.minor && this.patch > other.patch) {
            return 1;
        }

        return -1;
    }
}


export default {
    orElsePromise
};
