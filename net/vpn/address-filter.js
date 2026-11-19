import net from 'net';
import dns from 'dns';

// addresses an exit node never connects to, so nobody can reach the owner's
// home network or the exit node itself through it
const blockList = new net.BlockList();
[
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4]
].forEach(([address, prefix]) => blockList.addSubnet(address, prefix, 'ipv4'));
[
    ['::', 128],
    ['::1', 128],
    ['64:ff9b::', 96],
    ['100::', 64],
    ['2001:db8::', 32],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8]
].forEach(([address, prefix]) => blockList.addSubnet(address, prefix, 'ipv6'));


export function isPrivateAddress(address) {
    const family = net.isIP(address);
    if (family === 0) {
        return true;
    }
    if (family === 6) {
        // an ipv4-mapped address is checked as the ipv4 address it carries.
        // (BlockList matches ipv4 addresses against ::ffff:0:0/96 rules, so
        // that range cannot be a rule.)
        const mapped = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i.exec(address);
        if (mapped) {
            const ipv4 = mapped[1] || [
                parseInt(mapped[2], 16) >> 8,
                parseInt(mapped[2], 16) & 255,
                parseInt(mapped[3], 16) >> 8,
                parseInt(mapped[3], 16) & 255
            ].join('.');
            return isPrivateAddress(ipv4);
        }
    }
    return blockList.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * resolves a site name to the address to connect to. refuses the site if
 * any of its addresses is private or local, and returns the checked address
 * so the connection cannot be pointed elsewhere by a second lookup.
 * @param host
 * @return {Promise<{address, family}>}
 */
export function resolvePublicAddress(host) {
    const hostname = host.replace(/^\[(.*)]$/, '$1');
    if (net.isIP(hostname)) {
        return isPrivateAddress(hostname) ? Promise.reject('private_address') : Promise.resolve({
            address: hostname,
            family : net.isIP(hostname)
        });
    }

    if (!/^[a-z0-9.-]+$/i.test(hostname) || hostname.toLowerCase() === 'localhost' || hostname.toLowerCase().endsWith('.localhost')) {
        return Promise.reject('private_address');
    }

    return new Promise((resolve, reject) => {
        dns.lookup(hostname, {all: true}, (err, addressList) => {
            if (err || !addressList || addressList.length === 0) {
                return reject('host_not_found');
            }
            if (addressList.some(({address}) => isPrivateAddress(address))) {
                return reject('private_address');
            }
            resolve(addressList.find(({family}) => family === 4) || addressList[0]);
        });
    });
}

export default {
    isPrivateAddress,
    resolvePublicAddress
};
