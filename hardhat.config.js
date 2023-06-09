require("hardhat/config");
require('@nomiclabs/hardhat-waffle')
require('@nomiclabs/hardhat-ethers')
require('@typechain/hardhat')
require("@atixlabs/hardhat-time-n-mine");
require("@nomiclabs/hardhat-etherscan");
require('hardhat-contract-sizer');
require("@openzeppelin/hardhat-upgrades");
require('solidity-coverage')
require("hardhat-gas-reporter");
require('dotenv').config()

module.exports = {
  defaultNetwork: "hardhat",
  solidity: {
    compilers: [
      {
        version: "0.5.16",
        settings: {
          optimizer: {
            enabled: true,
            runs: 0
          }
        }
      },
      {
        version: "0.8.2",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      },
      {
        version: "0.6.12",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      },
      {
        version: "0.8.16",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      },
    ],
  },

  networks: {
    hardhat: {
      chainId: 1337,
      allowUnlimitedContractSize: true
    },
    sepolia: {
      url: process.env.SEPOLIA_URI,
      accounts: [
        process.env.PRIVATE_KEY_1,
        process.env.PRIVATE_KEY_2,
      ].filter(e => e),
    },
  },

  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://etherscan.io/
    apiKey: process.env.ETHERSCAN_API_KEY
  },

  typechain: {
    outDir: 'types',
    target: 'ethers-v5',
    // should overloads with full signatures like deposit(uint256) be generated always,
    // even if there are no overloads?
    alwaysGenerateOverloads: false,
  },

  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: false,
    strict: false,
  }
};
