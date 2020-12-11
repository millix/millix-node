import ecdsa from 'secp256k1';
import base58 from 'bs58';
import objectHash from './object-hash';


export function signWithPrivateKeyObject(messageBuffer, exPrivKey) {
    const privateKey    = exPrivKey.privateKey;
    const privKeyBuffer = privateKey.toBuffer({size: 32});
    const result        = ecdsa.sign(objectHash.getHashBuffer(messageBuffer, true), privKeyBuffer);
    return base58.encode(result.signature);
}

export function sign(hash, privKey, format) {
    const result = ecdsa.sign(hash, privKey);
    if(format === 'hex'){
        return result.signature.toString('hex');
    } else if(format === 'buffer'){
        return result.signature;
    }
    return base58.encode(result.signature);
}


export function verifyBuffer(hash, signature, publicKey) {
    try {
        return ecdsa.verify(hash, signature, publicKey);
    }
    catch (e) {
        console.log('signature verification exception: ' + e.toString());
        return false;
    }
}

export function verify(hash, b58Signature, b58PublicKey) {
    return verifyBuffer(hash, base58.decode(b58Signature), base58.decode(b58PublicKey));
}

export default {
    sign,
    signWithPrivateKeyObject,
    verify,
    verifyBuffer
};

