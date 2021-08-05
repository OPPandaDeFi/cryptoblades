pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

contract Buffs is Initializable, AccessControlUpgradeable {
    bytes32 public constant SHOP_KEEPER = keccak256("SHOP_KEEPER");

    function initialize() public initializer {
        __AccessControl_init();

        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    struct Buff {
        uint256 modifierAmount;
        uint64 endTimestamp; // standard timestamp in seconds-resolution marking regen start from 0
    }

    mapping(address => mapping(uint256 => Buff)) public buffs;
    uint256 public constant XP_BOOST = 1;
    uint256 public constant ENEMY_SPREAD = 2;
    uint256 public constant STR_BOOST = 3;

    modifier shopKeeper() {
        _shopKeeper();
        _;
    }

    function _shopKeeper() internal view {
        require(hasRole(SHOP_KEEPER, msg.sender), "Not shop keeper");
    }

    function set(address user, uint256 buffType, uint256 modifierAmount, uint64 endTimestamp) public shopKeeper {
        Buff storage buff = buffs[user][buffType];

        buff.modifierAmount = modifierAmount;
        buff.endTimestamp = endTimestamp;
    }

    function get(address user, uint256 buffType) public view returns (uint256) {
        Buff storage buff = buffs[user][buffType];

        if (buff.endTimestamp < now) {
            return 0;
        }

        return buff.modifierAmount;
    }
}
