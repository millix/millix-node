import wallet from '../wallet/wallet';
import database from '../../database/database';
import network from '../../net/network';
import _ from 'lodash';

function getCurrentWalletInfo() {
    let wallet_info = {
        network_initialized: network.initialized,
        node_id            : network.nodeID
    };

    if (wallet.initialized || !_.isEmpty(wallet.getActiveWallets())) {
        const keyIdentifier = wallet.defaultKeyIdentifier;
        return database.getRepository('address').getAddressBaseAttribute(keyIdentifier, 'key_public')
                       .then(publicKey => {
                           const addressVersion = database.getRepository('address').getDefaultAddressVersion().version;
                           return {
                               address_key_identifier: keyIdentifier,
                               address_version       : addressVersion,
                               address_public_key    : publicKey,
                               ...wallet_info
                           };
                       });
    }
    else {
        return new Promise((resolve) => {
            resolve(wallet_info);
        });
    }
}

export default {
    getCurrentWalletInfo
};
