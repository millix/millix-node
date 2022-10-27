import Endpoint from '../endpoint';
import crypto from 'crypto';
import wallet from '../../core/wallet/wallet';
import walletUtils from '../../core/wallet/wallet-utils';


/**
 * api cryptography
 */
class _ZXJ3DqyLslyQETkX extends Endpoint {
    constructor() {
        super('ZXJ3DqyLslyQETkX');
    }

    /**
     * depending on direction encrypt or decrypt provided string
     * @param app
     * @param req (p0: direction<required>, p1: string<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        if (!req.query.p0 || !req.query.p1) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<string> and p1<direction> are required'
            });
        }

        const direction      = req.query.p0;
        const subject_string = req.query.p1;
        const algorithm      = 'aes-256-cbc'; //Using AES encryption

        const extendedPrivateKey = wallet.getActiveWalletKey(wallet.getDefaultActiveWallet());
        const key                = walletUtils.derivePrivateKey(extendedPrivateKey, 0, 0);

        let result_string = '';
        if (direction === 'encrypt') {
            const iv      = crypto.randomBytes(16);
            let cipher    = crypto.createCipheriv(algorithm, Buffer.from(key), iv);
            let encrypted = cipher.update(subject_string);
            encrypted     = Buffer.concat([
                encrypted,
                cipher.final()
            ]);
            result_string = encrypted.toString('hex') + `[${iv.toString('hex')}]`;
        }
        else if (direction === 'decrypt') {
            const result_subject_string = subject_string.split('[');
            const iv_string             = result_subject_string.pop().replace(']', '');

            const iv           = Buffer.from(iv_string, 'hex');
            let encrypted_text = Buffer.from(result_subject_string.pop(), 'hex');
            let decipher       = crypto.createDecipheriv(algorithm, Buffer.from(key), iv);
            let decrypted      = decipher.update(encrypted_text);
            decrypted          = Buffer.concat([
                decrypted,
                decipher.final()
            ]);
            result_string      = decrypted.toString();
        }

        res.send({
            result: result_string
        });
    }
}


export default new _ZXJ3DqyLslyQETkX();
