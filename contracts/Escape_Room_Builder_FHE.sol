pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";


contract EscapeRoomBuilderFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    struct Batch {
        bool isOpen;
        uint256 createdAt;
        uint256 closedAt;
    }
    uint256 public currentBatchId;
    mapping(uint256 => Batch) public batches;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    // Encrypted puzzle data for a room
    struct EncryptedRoomData {
        euint32 encryptedSolutionHash; // FHE-encrypted hash of the solution string
        euint32 encryptedDifficulty;   // FHE-encrypted difficulty rating (e.g., 1-5)
        euint32 encryptedExpectedTime; // FHE-encrypted expected completion time in minutes
    }
    // Mapping: batchId => roomIndex => EncryptedRoomData
    mapping(uint256 => mapping(uint256 => EncryptedRoomData)) public encryptedRooms;
    mapping(uint256 => uint256) public roomsInBatchCount;


    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event CooldownSecondsSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId, uint256 timestamp);
    event BatchClosed(uint256 indexed batchId, uint256 timestamp);
    event RoomSubmitted(address indexed provider, uint256 indexed batchId, uint256 roomIndex);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId, address indexed requester);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 solutionHash, uint16 difficulty, uint16 expectedTime);

    error NotOwner();
    error NotProvider();
    error PausedError();
    error CooldownActive();
    error BatchNotOpen();
    error InvalidBatch();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidProof();
    error FHENotInitialized();
    error BatchAlreadyOpen();
    error BatchNotClosed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedError();
        _;
    }

    modifier respectCooldown(address user, mapping(address => uint256) storage accessTime, string memory errorMessage) {
        if (block.timestamp < accessTime[user] + cooldownSeconds) revert CooldownActive();
        accessTime[user] = block.timestamp;
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        _initIfNeeded();
        _openNewBatch();
        emit ProviderAdded(owner);
    }

    function _initIfNeeded() internal {
        if (!FHE.isInitialized()) {
            FHE.initialize();
        }
    }

    function _requireInitialized() internal view {
        if (!FHE.isInitialized()) revert FHENotInitialized();
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function setPaused(bool _paused) external onlyOwner {
        if (paused != _paused) {
            paused = _paused;
            if (_paused) {
                emit Paused(msg.sender);
            } else {
                emit Unpaused(msg.sender);
            }
        }
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        uint256 oldCooldownSeconds = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsSet(oldCooldownSeconds, newCooldownSeconds);
    }

    function _openNewBatch() internal {
        if (batches[currentBatchId].isOpen) revert BatchAlreadyOpen();
        currentBatchId++;
        batches[currentBatchId] = Batch({isOpen: true, createdAt: block.timestamp, closedAt: 0});
        emit BatchOpened(currentBatchId, block.timestamp);
    }

    function openNewBatch() external onlyOwner {
        _openNewBatch();
    }

    function closeCurrentBatch() external onlyOwner {
        if (!batches[currentBatchId].isOpen) revert BatchNotOpen();
        batches[currentBatchId].isOpen = false;
        batches[currentBatchId].closedAt = block.timestamp;
        emit BatchClosed(currentBatchId, block.timestamp);
        // Optionally, could auto-open a new batch here
    }

    function submitRoom(
        euint32 encryptedSolutionHash,
        euint32 encryptedDifficulty,
        euint32 encryptedExpectedTime
    ) external onlyProvider whenNotPaused respectCooldown(msg.sender, lastSubmissionTime, "Submission cooldown active") {
        _requireInitialized();
        if (!batches[currentBatchId].isOpen) revert BatchNotOpen();

        uint256 roomIndex = roomsInBatchCount[currentBatchId];
        encryptedRooms[currentBatchId][roomIndex] = EncryptedRoomData({
            encryptedSolutionHash: encryptedSolutionHash,
            encryptedDifficulty: encryptedDifficulty,
            encryptedExpectedTime: encryptedExpectedTime
        });
        roomsInBatchCount[currentBatchId] = roomIndex + 1;

        emit RoomSubmitted(msg.sender, currentBatchId, roomIndex);
    }

    function requestBatchSummaryDecryption(uint256 batchId) external whenNotPaused respectCooldown(msg.sender, lastDecryptionRequestTime, "Decryption request cooldown active") {
        _requireInitialized();
        if (batchId == 0 || batchId > currentBatchId) revert InvalidBatch();
        if (batches[batchId].isOpen) revert BatchNotClosed(); // Only decrypt closed batches

        uint256 numRooms = roomsInBatchCount[batchId];
        if (numRooms == 0) revert("No rooms in batch");

        euint32 encryptedTotalDifficulty;
        euint32 encryptedTotalExpectedTime;
        euint32 encryptedSolutionHashSum; // Sum of hashes, not for direct meaning but to ensure data is processed

        for (uint256 i = 0; i < numRooms; i++) {
            EncryptedRoomData storage room = encryptedRooms[batchId][i];
            if (i == 0) {
                encryptedTotalDifficulty = room.encryptedDifficulty;
                encryptedTotalExpectedTime = room.encryptedExpectedTime;
                encryptedSolutionHashSum = room.encryptedSolutionHash;
            } else {
                encryptedTotalDifficulty = encryptedTotalDifficulty.add(room.encryptedDifficulty);
                encryptedTotalExpectedTime = encryptedTotalExpectedTime.add(room.encryptedExpectedTime);
                encryptedSolutionHashSum = encryptedSolutionHashSum.add(room.encryptedSolutionHash);
            }
        }

        euint32 encryptedAvgDifficulty = encryptedTotalDifficulty.mul(FHE.asEuint32(numRooms).inv());
        euint32 encryptedAvgExpectedTime = encryptedTotalExpectedTime.mul(FHE.asEuint32(numRooms).inv());

        bytes32[] memory cts = new bytes32[](3);
        cts[0] = encryptedAvgDifficulty.toBytes32();
        cts[1] = encryptedAvgExpectedTime.toBytes32();
        cts[2] = encryptedSolutionHashSum.toBytes32(); // Included for state consistency

        bytes32 stateHash = keccak256(abi.encode(cts, address(this)));
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: batchId,
            stateHash: stateHash,
            processed: false
        });

        emit DecryptionRequested(requestId, batchId, msg.sender);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();
        // Security: Replay protection ensures this callback is processed only once for a given requestId.

        uint256 batchId = decryptionContexts[requestId].batchId;
        uint256 numRooms = roomsInBatchCount[batchId];

        // Security: Rebuild the ciphertexts array in the exact same order as during requestDecryption.
        // This is crucial for verifying that the contract state relevant to this decryption request
        // has not changed since the request was made.
        euint32 encryptedTotalDifficulty;
        euint32 encryptedTotalExpectedTime;
        euint32 encryptedSolutionHashSum;

        for (uint256 i = 0; i < numRooms; i++) {
            EncryptedRoomData storage room = encryptedRooms[batchId][i];
            if (i == 0) {
                encryptedTotalDifficulty = room.encryptedDifficulty;
                encryptedTotalExpectedTime = room.encryptedExpectedTime;
                encryptedSolutionHashSum = room.encryptedSolutionHash;
            } else {
                encryptedTotalDifficulty = encryptedTotalDifficulty.add(room.encryptedDifficulty);
                encryptedTotalExpectedTime = encryptedTotalExpectedTime.add(room.encryptedExpectedTime);
                encryptedSolutionHashSum = encryptedSolutionHashSum.add(room.encryptedSolutionHash);
            }
        }
        euint32 encryptedAvgDifficulty = encryptedTotalDifficulty.mul(FHE.asEuint32(numRooms).inv());
        euint32 encryptedAvgExpectedTime = encryptedTotalExpectedTime.mul(FHE.asEuint32(numRooms).inv());

        bytes32[] memory currentCts = new bytes32[](3);
        currentCts[0] = encryptedAvgDifficulty.toBytes32();
        currentCts[1] = encryptedAvgExpectedTime.toBytes32();
        currentCts[2] = encryptedSolutionHashSum.toBytes32();

        bytes32 currentStateHash = keccak256(abi.encode(currentCts, address(this)));
        if (currentStateHash != decryptionContexts[requestId].stateHash) revert StateMismatch();
        // Security: State verification ensures that the data being decrypted corresponds to the
        // state of the contract when the decryption was requested. This prevents certain classes
        // of front-running or manipulation attacks.

        FHE.checkSignatures(requestId, cleartexts, proof);
        // Security: Proof verification ensures the decryption was performed correctly by the FHEVM network.

        uint256 avgDifficulty = abi.decode(cleartexts[0], (uint256));
        uint256 avgExpectedTime = abi.decode(cleartexts[1], (uint256));
        // cleartexts[2] (solutionHashSum) is not directly used but was part of the state commitment.

        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, batchId, avgDifficulty, uint16(avgExpectedTime), uint16(avgDifficulty));
    }
}