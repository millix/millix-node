export default class Wallet {
    constructor(database) {
        this.database = database;
    }

    addWallet(walletID, account) {
        return new Promise((resolve) => {
            this.database.run('INSERT INTO wallet (wallet_id, account) VALUES (?,?)', [
                walletID,
                account
            ], () => {
                console.log('addWallet done ' + walletID);
                resolve();
            });
        });
    }

    walletExists(walletID) {
        return new Promise((resolve) => {
            this.database.get('SELECT * FROM wallet WHERE wallet_id=?', [walletID], (err, rows) => {
                resolve(rows !== undefined);
            });
        });
    }

    hasWallets() {
        return new Promise((resolve) => {
            this.database.get('SELECT * FROM wallet', [], (err, rows) => {
                resolve(rows !== undefined);
            });
        });
    }

    getWallet(walletID) {
        return new Promise((resolve, reject) => {
            this.database.get(
                'SELECT * FROM wallet where wallet_id = ?', [walletID],
                (err, row) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }
                    resolve(row);
                }
            );
        });
    }
}
