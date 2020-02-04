#!/bin/sh
myip=127.0.0.1 #$(hostname -i | awk '{print $1}')
echo "running on $myip"
echo "mysuperpass_change_me"|babel-node --max-old-space-size=8192 index.js --host $myip --port 10000 --debug --folder ./data/