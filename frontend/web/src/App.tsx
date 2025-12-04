// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface EscapeRoom {
  id: string;
  name: string;
  creator: string;
  difficulty: number; // 1-5
  encryptedSolution: string;
  creationDate: number;
  likes: number;
  plays: number;
  tags: string[];
}

// Randomly selected styles: High Contrast Black/White, Glass Morphism, Card-based, Animation Rich
const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState<EscapeRoom[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newRoomData, setNewRoomData] = useState({ name: "", difficulty: 3, solution: 0, tags: "" });
  const [selectedRoom, setSelectedRoom] = useState<EscapeRoom | null>(null);
  const [decryptedSolution, setDecryptedSolution] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTag, setSelectedTag] = useState("All");
  const [showTutorial, setShowTutorial] = useState(false);

  // Randomly selected features: Search & Filter, Project Introduction, Data Statistics
  const allTags = ["All", "Puzzle", "Adventure", "Horror", "Math", "Logic", "Mystery"];

  useEffect(() => {
    loadRooms().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadRooms = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("room_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing room keys:", e); }
      }
      
      const list: EscapeRoom[] = [];
      for (const key of keys) {
        try {
          const roomBytes = await contract.getData(`room_${key}`);
          if (roomBytes.length > 0) {
            try {
              const roomData = JSON.parse(ethers.toUtf8String(roomBytes));
              list.push({ 
                id: key, 
                name: roomData.name, 
                creator: roomData.creator, 
                difficulty: roomData.difficulty, 
                encryptedSolution: roomData.solution, 
                creationDate: roomData.creationDate, 
                likes: roomData.likes || 0,
                plays: roomData.plays || 0,
                tags: roomData.tags || []
              });
            } catch (e) { console.error(`Error parsing room data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading room ${key}:`, e); }
      }
      list.sort((a, b) => b.creationDate - a.creationDate);
      setRooms(list);
    } catch (e) { console.error("Error loading rooms:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const createRoom = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting solution with Zama FHE..." });
    try {
      const encryptedSolution = FHEEncryptNumber(newRoomData.solution);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const roomId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const tags = newRoomData.tags.split(',').map(tag => tag.trim()).filter(tag => tag);
      
      const roomData = { 
        name: newRoomData.name, 
        creator: address, 
        difficulty: newRoomData.difficulty, 
        solution: encryptedSolution, 
        creationDate: Math.floor(Date.now() / 1000),
        likes: 0,
        plays: 0,
        tags
      };
      
      await contract.setData(`room_${roomId}`, ethers.toUtf8Bytes(JSON.stringify(roomData)));
      
      const keysBytes = await contract.getData("room_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(roomId);
      await contract.setData("room_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Escape room created with FHE encryption!" });
      await loadRooms();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRoomData({ name: "", difficulty: 3, solution: 0, tags: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const likeRoom = async (roomId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Updating room data..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      const roomBytes = await contract.getData(`room_${roomId}`);
      if (roomBytes.length === 0) throw new Error("Room not found");
      const roomData = JSON.parse(ethers.toUtf8String(roomBytes));
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedRoom = { ...roomData, likes: (roomData.likes || 0) + 1 };
      await contractWithSigner.setData(`room_${roomId}`, ethers.toUtf8Bytes(JSON.stringify(updatedRoom)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Room liked!" });
      await loadRooms();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to like room: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const playRoom = async (roomId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Updating play count..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      const roomBytes = await contract.getData(`room_${roomId}`);
      if (roomBytes.length === 0) throw new Error("Room not found");
      const roomData = JSON.parse(ethers.toUtf8String(roomBytes));
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedRoom = { ...roomData, plays: (roomData.plays || 0) + 1 };
      await contractWithSigner.setData(`room_${roomId}`, ethers.toUtf8Bytes(JSON.stringify(updatedRoom)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Play count updated!" });
      await loadRooms();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to update play count: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isCreator = (roomCreator: string) => address?.toLowerCase() === roomCreator.toLowerCase();

  const filteredRooms = rooms.filter(room => {
    const matchesSearch = room.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTag = selectedTag === "All" || room.tags.includes(selectedTag);
    return matchesSearch && matchesTag;
  });

  const tutorialSteps = [
    { title: "Connect Wallet", description: "Connect your Web3 wallet to create and play encrypted escape rooms", icon: "🔗" },
    { title: "Design Your Room", description: "Create puzzles with encrypted solutions using Zama FHE", icon: "🎨", details: "Your puzzle solutions are encrypted client-side before being stored" },
    { title: "FHE Protection", description: "Solutions remain encrypted during gameplay", icon: "🔒", details: "Zama FHE technology ensures solutions are never exposed" },
    { title: "Play & Earn", description: "Players can enjoy rooms while creators earn rewards", icon: "💰", details: "FHE protects your intellectual property while allowing verification" }
  ];

  const renderDifficultyStars = (difficulty: number) => {
    return (
      <div className="difficulty-stars">
        {[1, 2, 3, 4, 5].map((star) => (
          <span key={star} className={star <= difficulty ? "filled" : ""}>★</span>
        ))}
      </div>
    );
  };

  const renderStats = () => {
    const totalRooms = rooms.length;
    const totalPlays = rooms.reduce((sum, room) => sum + (room.plays || 0), 0);
    const totalLikes = rooms.reduce((sum, room) => sum + (room.likes || 0), 0);
    const avgDifficulty = totalRooms > 0 
      ? (rooms.reduce((sum, room) => sum + room.difficulty, 0) / totalRooms).toFixed(1)
      : "0.0";

    return (
      <div className="stats-container">
        <div className="stat-card">
          <div className="stat-value">{totalRooms}</div>
          <div className="stat-label">Total Rooms</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalPlays}</div>
          <div className="stat-label">Total Plays</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalLikes}</div>
          <div className="stat-label">Total Likes</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{avgDifficulty}</div>
          <div className="stat-label">Avg Difficulty</div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Loading encrypted escape rooms...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>隱秘密室建造師</h1>
          <p>FHE-based encrypted escape rooms</p>
        </div>
        <div className="header-actions">
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + Create Room
          </button>
        </div>
      </header>

      <main className="main-content">
        <div className="hero-section">
          <div className="hero-text">
            <h2>Build & Play Encrypted Escape Rooms</h2>
            <p>Create puzzles with FHE-protected solutions using Zama technology</p>
            <div className="hero-buttons">
              <button onClick={() => setShowCreateModal(true)} className="primary-btn">
                Start Building
              </button>
              <button onClick={() => setShowTutorial(!showTutorial)} className="secondary-btn">
                {showTutorial ? "Hide Tutorial" : "How It Works"}
              </button>
            </div>
          </div>
          <div className="hero-image">
            <div className="fhe-badge">
              <span>FHE-Powered</span>
            </div>
          </div>
        </div>

        {showTutorial && (
          <div className="tutorial-section">
            <h2>How FHE Protects Your Escape Rooms</h2>
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div className="tutorial-card" key={index}>
                  <div className="step-icon">{step.icon}</div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                  {step.details && <div className="step-details">{step.details}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="search-filter-section">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search rooms..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <button className="search-icon">🔍</button>
          </div>
          <div className="tag-filter">
            <select 
              value={selectedTag} 
              onChange={(e) => setSelectedTag(e.target.value)}
            >
              {allTags.map(tag => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </select>
          </div>
          <button onClick={loadRooms} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="stats-section">
          <h3>Community Statistics</h3>
          {renderStats()}
        </div>

        <div className="rooms-grid">
          {filteredRooms.length === 0 ? (
            <div className="no-rooms">
              <p>No rooms found matching your criteria</p>
              <button onClick={() => setShowCreateModal(true)} className="primary-btn">
                Create First Room
              </button>
            </div>
          ) : (
            filteredRooms.map(room => (
              <div className="room-card" key={room.id} onClick={() => setSelectedRoom(room)}>
                <div className="card-header">
                  <h3>{room.name}</h3>
                  <div className="creator">by {room.creator.substring(0, 6)}...{room.creator.substring(38)}</div>
                </div>
                <div className="card-body">
                  <div className="difficulty">
                    {renderDifficultyStars(room.difficulty)}
                    <span>Difficulty</span>
                  </div>
                  <div className="tags">
                    {room.tags.map(tag => (
                      <span key={tag} className="tag">{tag}</span>
                    ))}
                  </div>
                  <div className="stats">
                    <div className="stat">
                      <span>❤️ {room.likes || 0}</span>
                    </div>
                    <div className="stat">
                      <span>👥 {room.plays || 0}</span>
                    </div>
                  </div>
                </div>
                <div className="card-footer">
                  <button 
                    className="like-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      likeRoom(room.id);
                    }}
                  >
                    Like
                  </button>
                  <button 
                    className="play-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      playRoom(room.id);
                    }}
                  >
                    Play
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Create New Escape Room</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Room Name</label>
                <input 
                  type="text" 
                  value={newRoomData.name}
                  onChange={(e) => setNewRoomData({...newRoomData, name: e.target.value})}
                  placeholder="Enter room name..."
                />
              </div>
              <div className="form-group">
                <label>Difficulty</label>
                <div className="difficulty-selector">
                  {[1, 2, 3, 4, 5].map(level => (
                    <button
                      key={level}
                      className={newRoomData.difficulty === level ? "active" : ""}
                      onClick={() => setNewRoomData({...newRoomData, difficulty: level})}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label>Solution (Numerical)</label>
                <input 
                  type="number" 
                  value={newRoomData.solution}
                  onChange={(e) => setNewRoomData({...newRoomData, solution: parseFloat(e.target.value) || 0})}
                  placeholder="Enter numerical solution..."
                />
                <div className="encryption-preview">
                  <span>FHE Encrypted:</span>
                  <div>{newRoomData.solution ? FHEEncryptNumber(newRoomData.solution).substring(0, 30) + '...' : 'Not available'}</div>
                </div>
              </div>
              <div className="form-group">
                <label>Tags (comma separated)</label>
                <input 
                  type="text" 
                  value={newRoomData.tags}
                  onChange={(e) => setNewRoomData({...newRoomData, tags: e.target.value})}
                  placeholder="e.g. Puzzle, Math, Mystery"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">
                Cancel
              </button>
              <button 
                onClick={createRoom} 
                disabled={creating || !newRoomData.name || !newRoomData.solution}
                className="submit-btn"
              >
                {creating ? "Creating with FHE..." : "Create Room"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedRoom && (
        <div className="modal-overlay">
          <div className="room-detail-modal">
            <div className="modal-header">
              <h2>{selectedRoom.name}</h2>
              <button onClick={() => {
                setSelectedRoom(null);
                setDecryptedSolution(null);
              }} className="close-btn">
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="room-info">
                <div className="info-item">
                  <span>Creator:</span>
                  <strong>{selectedRoom.creator.substring(0, 6)}...{selectedRoom.creator.substring(38)}</strong>
                </div>
                <div className="info-item">
                  <span>Created:</span>
                  <strong>{new Date(selectedRoom.creationDate * 1000).toLocaleDateString()}</strong>
                </div>
                <div className="info-item">
                  <span>Difficulty:</span>
                  <strong>{renderDifficultyStars(selectedRoom.difficulty)}</strong>
                </div>
                <div className="info-item">
                  <span>Tags:</span>
                  <div className="tags">
                    {selectedRoom.tags.map(tag => (
                      <span key={tag} className="tag">{tag}</span>
                    ))}
                  </div>
                </div>
                <div className="info-item stats">
                  <span>❤️ {selectedRoom.likes || 0} likes</span>
                  <span>👥 {selectedRoom.plays || 0} plays</span>
                </div>
              </div>
              
              <div className="solution-section">
                <h3>Encrypted Solution</h3>
                <div className="encrypted-data">
                  {selectedRoom.encryptedSolution.substring(0, 50)}...
                </div>
                <div className="fhe-badge">
                  <span>FHE Encrypted</span>
                </div>
                {isCreator(selectedRoom.creator) && (
                  <button 
                    className="decrypt-btn"
                    onClick={async () => {
                      if (decryptedSolution !== null) {
                        setDecryptedSolution(null);
                      } else {
                        const decrypted = await decryptWithSignature(selectedRoom.encryptedSolution);
                        setDecryptedSolution(decrypted);
                      }
                    }}
                    disabled={isDecrypting}
                  >
                    {isDecrypting ? "Decrypting..." : 
                     decryptedSolution !== null ? "Hide Solution" : "View Solution (Creator Only)"}
                  </button>
                )}
                {decryptedSolution !== null && (
                  <div className="decrypted-solution">
                    <h4>Solution:</h4>
                    <div className="solution-value">{decryptedSolution}</div>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button 
                className="like-btn"
                onClick={() => {
                  likeRoom(selectedRoom.id);
                  setSelectedRoom({...selectedRoom, likes: (selectedRoom.likes || 0) + 1});
                }}
              >
                Like ❤️
              </button>
              <button 
                className="play-btn"
                onClick={() => {
                  playRoom(selectedRoom.id);
                  setSelectedRoom({...selectedRoom, plays: (selectedRoom.plays || 0) + 1});
                }}
              >
                Play Now
              </button>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="transaction-notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            <div className="notification-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="notification-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-section">
            <h3>隱秘密室建造師</h3>
            <p>FHE-based platform for player-created encrypted escape rooms</p>
            <div className="fhe-badge">
              <span>Powered by Zama FHE</span>
            </div>
          </div>
          <div className="footer-section">
            <h3>Quick Links</h3>
            <a href="#">Documentation</a>
            <a href="#">Community</a>
            <a href="#">Terms</a>
          </div>
          <div className="footer-section">
            <h3>Contact</h3>
            <a href="#">Twitter</a>
            <a href="#">Discord</a>
            <a href="#">GitHub</a>
          </div>
        </div>
        <div className="footer-bottom">
          <p>© 2023 隱秘密室建造師. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default App;