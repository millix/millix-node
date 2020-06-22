import Migration from './migration';
import walletUtils from '../../core/wallet/wallet-utils';
import base58 from 'bs58';

export default new (class Migrate extends Migration {

    migrate(db, migrationFile) {
        return new Promise((resolve, reject) => {
            walletUtils.loadNodeKeyAndCertificate()
                       .then(({node_public_key: publicKey}) => walletUtils.getNodeIdFromPublicKey(base58.encode(publicKey.toBuffer())))
                       .then((nodeID) => this.runMigrateScript(db, migrationFile, {node_id: nodeID}))
                       .then(() => resolve())
                       .catch((e) => reject(e));

        });
    }
});
