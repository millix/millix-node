import crypto from 'crypto';
import base32 from 'thirty-two';
import base58 from 'bs58';

const PI                 = '14159265358979323846264338327950288419716939937510';
const zeroString         = '00000000';
const arrRelativeOffsets = PI.split('');

function checkLength(cHashLength) {
    if (cHashLength !== 160 && cHashLength !== 288) {
        throw Error('unsupported c-hash length: ' + cHashLength);
    }
}

function calcOffsets(cHashLength) {
    checkLength(cHashLength);
    let arrOffsets = [];
    let offset     = 0;
    let index      = 0;

    for (let i = 0; offset < cHashLength; i++) {
        const relativeOffset = parseInt(arrRelativeOffsets[i]);
        if (relativeOffset === 0) {
            continue;
        }
        offset += relativeOffset;
        if (cHashLength === 288) {
            offset += 4;
        }
        if (offset >= cHashLength) {
            break;
        }
        arrOffsets.push(offset);
        index++;
    }

    if (index !== 32) {
        throw Error('wrong number of checksum bits');
    }

    return arrOffsets;
}

const arrOffsets160 = calcOffsets(160);
const arrOffsets288 = calcOffsets(288);

function separateIntoCleanDataAndChecksum(bin) {
    const len = bin.length;
    let arrOffsets;
    if (len === 160) {
        arrOffsets = arrOffsets160;
    }
    else if (len === 288) {
        arrOffsets = arrOffsets288;
    }
    else {
        throw Error('bad length=' + len + ', bin = ' + bin);
    }
    let arrFrags        = [];
    let arrChecksumBits = [];
    let start           = 0;
    for (let i = 0; i < arrOffsets.length; i++) {
        arrFrags.push(bin.substring(start, arrOffsets[i]));
        arrChecksumBits.push(bin.substr(arrOffsets[i], 1));
        start = arrOffsets[i] + 1;
    }
    // add last frag
    if (start < bin.length) {
        arrFrags.push(bin.substring(start));
    }
    const binCleanData = arrFrags.join('');
    const binChecksum  = arrChecksumBits.join('');
    return {
        clean_data: binCleanData,
        checksum  : binChecksum
    };
}

function mixChecksumIntoCleanData(binCleanData, binChecksum) {
    if (binChecksum.length !== 32) {
        throw Error('bad checksum length');
    }
    const len = binCleanData.length + binChecksum.length;
    let arrOffsets;
    if (len === 160) {
        arrOffsets = arrOffsets160;
    }
    else if (len === 288) {
        arrOffsets = arrOffsets288;
    }
    else {
        throw Error('bad length=' + len + ', clean data = ' + binCleanData + ', checksum = ' + binChecksum);
    }
    let arrFrags        = [];
    let arrChecksumBits = binChecksum.split('');
    let start           = 0;
    for (let i = 0; i < arrOffsets.length; i++) {
        const end = arrOffsets[i] - i;
        arrFrags.push(binCleanData.substring(start, end));
        arrFrags.push(arrChecksumBits[i]);
        start = end;
    }
    // add last frag
    if (start < binCleanData.length) {
        arrFrags.push(binCleanData.substring(start));
    }
    return arrFrags.join('');
}

function buffer2bin(buf) {
    let bytes = [];
    for (let i = 0; i < buf.length; i++) {
        let bin = buf[i].toString(2);
        if (bin.length < 8) // pad with zeros
        {
            bin = zeroString.substring(bin.length, 8) + bin;
        }
        bytes.push(bin);
    }
    return bytes.join('');
}

function bin2buffer(bin) {
    const len = bin.length / 8;
    let buf   = Buffer.alloc(len);
    for (let i = 0; i < len; i++) {
        buf[i] = parseInt(bin.substr(i * 8, 8), 2);
    }
    return buf;
}

function getChecksum(cleanData) {
    const fullChecksum = crypto.createHash('sha256').update(cleanData).digest();
    const checksum      = Buffer.from([
        fullChecksum[5],
        fullChecksum[13],
        fullChecksum[21],
        fullChecksum[29]
    ]);
    return checksum;
}

function getCHash(data, cHashLength) {
    checkLength(cHashLength);
    const hash           = crypto.createHash((cHashLength === 160) ? 'ripemd160' : 'sha256').update(data, 'utf8').digest();
    const truncatedHash = (cHashLength === 160) ? hash.slice(4) : hash; // drop
                                                                          // first
                                                                          // 4
                                                                          // bytes
                                                                          // if
                                                                          // 160

    const checksum = getChecksum(truncatedHash);

    const binCleanData = buffer2bin(truncatedHash);
    const binChecksum  = buffer2bin(checksum);
    const binCHash     = mixChecksumIntoCleanData(binCleanData, binChecksum);
    const cHash        = bin2buffer(binCHash);
    const encoded      = (cHashLength === 160) ? base32.encode(cHash).toString() : base58.encode(cHash);
    return encoded;
}

function getCHash160(data) {
    return getCHash(data, 160);
}

function getCHash288(data) {
    return getCHash(data, 288);
}

function isCHashValid(encoded) {
    const encodedLen = encoded.length;
    if (encodedLen !== 32 && encodedLen !== 48) // 160/5 = 32, 288/6 = 48
    {
        throw Error('wrong encoded length: ' + encodedLen);
    }

    let cHash;

    try {
        cHash = (encodedLen === 32) ? base32.decode(encoded) : base58.decode(encoded);
    }
    catch (e) {
        console.log(e);
        return false;
    }
    const binCHash   = buffer2bin(cHash);
    const separated  = separateIntoCleanDataAndChecksum(binCHash);
    const cleanData = bin2buffer(separated.clean_data);

    const checksum = bin2buffer(separated.checksum);
    return checksum.equals(getChecksum(cleanData));
}

export default {
    getCHash160,
    getCHash288,
    isCHashValid
};
