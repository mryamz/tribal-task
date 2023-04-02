pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import "./UniswapAnchoredViewInterface.sol";
import "./CToken.sol";


contract UniswapAnchoredViewProxy  {

    UniswapAnchoredViewInterface public uav;
    address public admin;

    constructor(UniswapAnchoredViewInterface _uav) public {
        uav = _uav;
        admin = msg.sender;
    }


    /**
      * @notice Get the underlying price of a cToken asset
      * @param cToken The cToken to get the underlying price of
      * @return The underlying asset price mantissa (scaled by 1e18).
      *  Zero means the price is unavailable.
      */
    function getUnderlyingPrice(CToken cToken) external view returns (uint248) {
        UniswapAnchoredViewInterface.PriceData memory priceData = uav.prices(keccak256(abi.encodePacked(cToken.symbol())));
        return priceData.price;
    }

    function setUniswapAnchoredView(address _uav) public {
        require(msg.sender == admin, "Invaid User");
        uav = UniswapAnchoredViewInterface(_uav);
    }
}