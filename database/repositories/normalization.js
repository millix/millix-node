export default class Normalization {
    constructor(database) {
        this.database = database;
        this.entries  = {};
    }

    load() {
        return new Promise((resolve, reject) => {
            this.database.all('SELECT * FROM normalization', (err, rows) => {
                if (err) {
                    return reject(err.message);
                }

                rows.forEach(row => this.entries[row.normalization_name] = row.normalization_id);
                resolve();
            });
        });
    }

    get(name) {
        return this.entries[name];
    }

}
