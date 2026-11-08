import {Database} from '../database';
import ntp from '../../core/ntp';

export default class CloudOffer {
    constructor(database) {
        this.database = database;
    }

    /**
     * stores a verified offer unless an offer from the same node for the same
     * service with the same or a newer publish date is already stored. an
     * older offer from the same node for the same service is replaced.
     * @param offer verified offer
     * @return {Promise<boolean>} true if the offer is stored after the call
     */
    addOffer(offer) {
        return new Promise((resolve, reject) => {
            this.database.run('INSERT OR REPLACE INTO cloud_offer (offer_id, node_id, service, country, city, publish_date, end_date, offer) ' +
                              'SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM cloud_offer WHERE node_id = ? AND service = ? AND publish_date >= ?)',
                [
                    offer.offer_id,
                    offer.node_id,
                    offer.service,
                    offer.location.country,
                    offer.location.city || null,
                    offer.create_date,
                    offer.end_date,
                    JSON.stringify(offer),
                    offer.node_id,
                    offer.service,
                    offer.create_date
                ], (err) => {
                    if (err) {
                        return reject(err.message || err);
                    }
                    this.hasOffer(offer.offer_id).then(resolve).catch(reject);
                });
        });
    }

    hasOffer(offerID) {
        return new Promise((resolve, reject) => {
            this.database.get('SELECT 1 AS found FROM cloud_offer WHERE offer_id = ?', [offerID], (err, row) => {
                if (err) {
                    return reject(err.message || err);
                }
                resolve(!!row);
            });
        });
    }

    getOffer(nodeID, service) {
        return new Promise((resolve, reject) => {
            this.database.get('SELECT offer FROM cloud_offer WHERE node_id = ? AND service = ?', [
                nodeID,
                service
            ], (err, row) => {
                if (err) {
                    return reject(err.message || err);
                }
                resolve(row ? JSON.parse(row.offer) : undefined);
            });
        });
    }

    /**
     * lists offers whose end date is still in the future.
     * @param where {service, country, node_id}
     * @param orderBy
     * @param limit
     * @return {Promise<Array>} the signed offers
     */
    listOffers(where, orderBy, limit) {
        return new Promise((resolve, reject) => {
            const now = Math.floor(ntp.now().getTime() / 1000);
            let {
                    sql,
                    parameters
                } = Database.buildQuery('SELECT offer FROM cloud_offer', {
                ...where,
                end_date_min: now + 1
            }, orderBy, limit);
            this.database.all(sql, parameters, (err, rows) => {
                if (err) {
                    return reject(err.message || err);
                }
                resolve(rows.map(row => JSON.parse(row.offer)));
            });
        });
    }

    removeExpiredOffers() {
        return new Promise((resolve, reject) => {
            const now = Math.floor(ntp.now().getTime() / 1000);
            this.database.run('DELETE FROM cloud_offer WHERE end_date <= ?', [now], (err) => {
                if (err) {
                    return reject(err.message || err);
                }
                resolve();
            });
        });
    }
}
