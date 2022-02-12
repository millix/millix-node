<h1 align="center">
  <br>
  <a href="#"><img src="https://github.com/millix/millix-wallet/blob/master/app/icon.png?raw=true" alt="millix node" width="200"></a>
  <br>
  millix node <small>v1.12.7</small>
  <br>
</h1>

## Main Features

- DAG-backed cryptocurrency
- Multiple wallet creation and management in-app
- Easy to send and receive transactions
- [BIP32](https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki) Hierarchical deterministic (HD) address generation and wallet backups
- Device-based security: all private keys are stored locally, not in the cloud
- Support for testnet
- Mnemonic ([BIP39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki)) support for wallet backups
- Support [macOS](?#), [Linux](?#), [Windows](?#) devices

## About millix

### Principles

- Currencies should not be created with debt.
- Currencies should operate at infinite scale.
- Currencies should work the same throughout the entire spectrum of transaction values.
- Currencies should be exchanged with no fee. 
- Currencies should be functional without carrying the weight of every previous transaction.
- Modern currencies should be at least as simple to use as primitive currencies.
- Implementing a digital currency into a process should be nearly the same effort as implementing paper cash into a process, where any additional difficulty implementing a digital currency is indisputably offset by benefits. 
- Simplicity at the edge is the only possible with equal simplicity in the foundation.
- Currencies are a product chosen by customers and supported by professionals. Customers and professionals require services and support.
- The cost of securing value can't exceed the value it secures.
- Decreasing a currency's value with inflation should not dilute the value of savers.
- Increasing a currency's market value should be proportionate to increases in its' fundamental value.
- Participants that increase fundamental value should be algorithmically incentivized. 


## Installation


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
git clone https://github.com/millix/millix-node.git -b develop
````

## Run millix-node
```
cd millix-node
vi run-millix-node.sh
#replace “127.0.0.1” with your ip  (find by whatismyip)
```

### Run:
```
sudo npm install -g @babel/cli @babel/core @babel/node
npm install
sudo chmod +x run-millix-node.sh.sh
sh run-millix-node.sh.sh
```

## How to Contribute

Anyone and everyone is welcome to contribute. Please take a moment to review the [guidelines for contributing](CONTRIBUTING.md).

- [bug reports](CONTRIBUTING.md#bugs)
- [feature requests](CONTRIBUTING.md#features)
- [pull requests](CONTRIBUTING.md#pull-requests)

### getting started 

1. Clone repo and create a new branch: `$ git checkout git@github.com:millix/millix-node.git -b <<name_for_new_branch>>`.
2. Make changes and test
3. Submit Pull Request with comprehensive description of changes


## Release Schedules

Copay uses the `MAJOR.MINOR.BATCH` convention for versioning. Any release that adds features should modify the MINOR or MAJOR number.

### Bug Fixing Releases

We release bug fixes as soon as possible for all platforms. There is no coordination so all platforms are updated at the same time.

## Support

Please see [Support requests](CONTRIBUTING.md#support)

## License

Copay is released under the MIT License. Please refer to the [LICENSE](LICENSE) file that accompanies this project for more information including complete terms and conditions.
