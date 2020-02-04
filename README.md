# millix node

## Install nodejs 12
```
 sudo apt update
 sudo apt -y install curl dirmngr apt-transport-https lsb-release ca-certificates build-essential
 curl -sL https://deb.nodesource.com/setup_12.x | sudo -E bash -
 sudo apt-get -y install nodejs
 node --version (check version: should be 12.x.x)
 ```
 
## Download millix-node code
```
git clone git@github.com:millix/millix-node.git
````

## Run millix-node
```
cd millix-node
vi run_node.sh
#replace “127.0.0.1” with your ip  (find by whatismyip)
#replace “mysuperpass_change_me” with your wallet passphrase
```

### Run:
```
sudo npm install -g @babel/cli @babel/core @babel/node
npm install
sudo chmod +x run_node.sh
sh run_node.sh
```
