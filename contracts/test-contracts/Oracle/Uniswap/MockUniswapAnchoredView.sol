pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./UniswapConfig.sol";
import "./UniswapLib.sol";
import "../Ownable.sol";
import "../Chainlink/AggregatorValidatorInterface.sol";
import "./UniswapAnchoredView.sol";

contract MockUniswapAnchoredView is UniswapAnchoredView {

    constructor(TokenConfig[] memory configs) UniswapAnchoredView(1e17, 60, configs) public {

    }

    function setPrice(bytes32 hashedSymbol, PriceData memory data) public  {
        prices[hashedSymbol] = data;
    }

}