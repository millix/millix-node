import https from 'https';
import walletUtils from '../../core/wallet/wallet-utils';

const RESPONSE_SIZE_MAX = 256 * 1024;


/**
 * sends a json request to a service of another node over tls with that
 * node's certificate. the node is identified by the node id its certificate
 * carries, not by a certificate authority: the request fails with
 * node_certificate_invalid unless the certificate carries nodeID.
 * @param endpoint {node_address, service_port}
 * @param nodeID
 * @param method
 * @param path
 * @param body
 * @param timeout ms
 * @return {Promise<Object>} the json response of a 200 response; otherwise
 * rejects with the response's error
 */
export function requestNodeService(endpoint, nodeID, method, path, body, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const data    = body === undefined ? undefined : JSON.stringify(body);
        const request = https.request({
            host              : endpoint.node_address,
            port              : endpoint.service_port,
            method,
            path,
            timeout,
            rejectUnauthorized: false,
            checkServerIdentity: () => undefined,
            headers           : data ? {
                'Content-Type'  : 'application/json',
                'Content-Length': Buffer.byteLength(data)
            } : {}
        }, response => {
            let responseData = '';
            response.setEncoding('utf8');
            response.on('data', chunk => {
                responseData += chunk;
                if (responseData.length > RESPONSE_SIZE_MAX) {
                    request.destroy();
                    reject('response_too_large');
                }
            });
            response.on('end', () => {
                let result;
                try {
                    result = JSON.parse(responseData);
                }
                catch (e) {
                    return reject('response_invalid');
                }
                response.statusCode === 200 ? resolve(result) : reject(result.error || `status_${response.statusCode}`);
            });
        });
        request.on('socket', socket => socket.on('secureConnect', () => {
            let peerNodeID;
            try {
                peerNodeID = walletUtils.getNodeIdFromCertificate(socket.getPeerCertificate().raw.toString('hex'), 'hex');
            }
            catch (e) {
            }
            if (peerNodeID !== nodeID) {
                request.destroy();
                reject('node_certificate_invalid');
            }
        }));
        request.on('timeout', () => {
            request.destroy();
            reject('node_request_timeout');
        });
        request.on('error', error => reject(error.code || error.message || error));
        data ? request.end(data) : request.end();
    });
}

/**
 * reads a json request body of at most sizeMax bytes
 */
export function readJSONBody(request, sizeMax) {
    return new Promise((resolve, reject) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', chunk => {
            body += chunk;
            if (body.length > sizeMax) {
                reject('body_too_large');
                request.destroy();
            }
        });
        request.on('end', () => {
            try {
                resolve(JSON.parse(body));
            }
            catch (e) {
                reject('body_invalid');
            }
        });
        request.on('error', reject);
    });
}

export function sendJSON(response, status, body) {
    if (response.headersSent) {
        return;
    }
    const data = JSON.stringify(body);
    response.writeHead(status, {
        'Content-Type'  : 'application/json',
        'Content-Length': Buffer.byteLength(data)
    });
    response.end(data);
}
