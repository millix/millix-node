import NtpTimeSync from 'ntp-time-sync';
import console from './console';

let ntp         = NtpTimeSync.getInstance();
ntp.offset      = 0;
ntp.initialized = false;
// request 1
let initialize  = () => {
    ntp.getTime().then(function(result) {
        console.log('[millix-node] current system time', new Date());
        console.log('[millix-node] real time', result.now);
        console.log('[millix-node] offset in milliseconds', result.offset);
        ntp.offset      = result.offset;
        ntp.initialized = true;
    })
       .catch(() => initialize());
};

initialize();

ntp.now = function() {
    let timeNow = new Date();
    timeNow.setUTCMilliseconds(timeNow.getUTCMilliseconds() + ntp.offset);
    return timeNow;
};

export default ntp;
