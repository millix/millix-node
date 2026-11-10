// signs the minimum node version for tangled cloud features with tangled's
// key. run offline, on the computer that holds the key:
//
//   npx babel-node scripts/cloud/sign-version-min.js --new-key <key file>
//     writes a new private key to <key file> (readable only by you) and
//     prints its public key, the value for CLOUD_AUTHORITY_PUBLIC_KEY
//
//   npx babel-node scripts/cloud/sign-version-min.js --key <key file>
//     --version-min 1.27.0 [--network main|test]
//     prints the signed message. give it to any node with the
//     add_cloud_version_min api (ITvNfxeO8gUM1VEh, p0=<message>) and it
//     spreads to every node.
//
// the key file holds the 32 byte private key as hex. nothing is sent
// anywhere.
import fs from 'fs';
import crypto from 'crypto';
import base58 from 'bs58';
import secp256k1 from 'secp256k1';
import objectHash from '../../core/crypto/object-hash';
import signature from '../../core/crypto/signature';

// the message format of net/cloud-version.js (CLOUD_VERSION_MESSAGE_VERSION
// 1). this tool does not load the node, so it opens no connection.
function signVersionMin(versionMin, createDate, privateKey, networkName) {
    const body = {
        version    : 1,
        network    : networkName,
        version_min: versionMin,
        create_date: createDate
    };
    return {
        ...body,
        signature: signature.sign(objectHash.getHashBuffer(body), privateKey)
    };
}

const argv = require('yargs').argv;

function publicKeyOf(privateKey) {
    return base58.encode(Buffer.from(secp256k1.publicKeyCreate(privateKey, true)));
}

if (argv.newKey) {
    if (fs.existsSync(argv.newKey)) {
        console.error(`${argv.newKey} exists, not overwritten`);
        process.exit(1);
    }
    let privateKey;
    do {
        privateKey = crypto.randomBytes(32);
    }
    while (!secp256k1.privateKeyVerify(privateKey));
    fs.writeFileSync(argv.newKey, privateKey.toString('hex'), {mode: 0o600});
    console.log(JSON.stringify({public_key: publicKeyOf(privateKey)}));
    process.exit(0);
}

if (!argv.key || !argv.versionMin || !/^\d+\.\d+\.\d+$/.test(argv.versionMin)) {
    console.error('usage: --key <key file> --version-min <x.y.z> [--network main|test], or --new-key <key file>');
    process.exit(1);
}

const privateKey = Buffer.from(fs.readFileSync(argv.key, 'utf8').trim(), 'hex');
const network    = argv.network || 'main';
const message    = signVersionMin(argv.versionMin, Math.floor(Date.now() / 1000), privateKey, network);
console.log(JSON.stringify({
    public_key: publicKeyOf(privateKey),
    message
}));
process.exit(0);
