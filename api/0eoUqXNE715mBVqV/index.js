import database from '../../database/database';


// api list_peer
class _0eoUqXNE715mBVqV {
    constructor() {
        this.endpoint = '0eoUqXNE715mBVqV';
    }

    register(app, apiURL) {
        const nodeRepository = database.getRepository('node');
        app.get(apiURL + this.endpoint, (_, res) => {
            nodeRepository.getNodes()
                          .then(nodes => {
                              res.send(nodes);
                          });
        });
    }
};

export default new _0eoUqXNE715mBVqV();
