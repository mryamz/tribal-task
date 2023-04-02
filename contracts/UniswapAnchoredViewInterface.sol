pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

contract UniswapAnchoredViewInterface {

    struct PriceData {
        uint248 price;
        bool failoverActive;
    }
    function prices(bytes32 symbolHash) external view returns (PriceData memory);

}