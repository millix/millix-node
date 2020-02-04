import ecdsa from 'secp256k1';
import base58 from 'bs58';
import objectHash from './object-hash';


export function signWithPrivateKeyObject(messageBuffer, exPrivKey) {
    const privateKey    = exPrivKey.privateKey;
    const privKeyBuffer = privateKey.toBuffer({size: 32});
    const result        = ecdsa.sign(objectHash.getHashBuffer(messageBuffer, true), privKeyBuffer);
    return base58.encode(result.signature);
}

export function sign(hash, privKey) {
    const result = ecdsa.sign(hash, privKey);
    return base58.encode(result.signature);
}

export function verify(hash, b58Signature, b58PublicKey) {
    try {
        return ecdsa.verify(hash, base58.decode(b58Signature), base58.decode(b58PublicKey));
    }
    catch (e) {
        console.log('signature verification exception: ' + e.toString());
        return false;
    }
}

export default {
    sign,
    signWithPrivateKeyObject,
    verify
};

