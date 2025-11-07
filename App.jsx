import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- Global Variables (Provided by Canvas Environment) ---
// Initialize these variables from global context for Firestore configuration
const firebaseConfig = typeof __firebase_config !== 'undefined'
    ? JSON.parse(__firebase_config)
    : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Currency formatting utility
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount);
};

// Component to handle user input (used for Buy, Sell, Deposit, Withdraw)
const InputModal = ({ title, label, buttonText, onSubmit, onClose, isVisible, currentBalance }) => {
    const [value, setValue] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = () => {
        const numericValue = parseFloat(value);
        if (isNaN(numericValue) || numericValue <= 0) {
            setError('Please enter a positive numeric amount.');
            return;
        }

        // Basic withdrawal check (USD)
        if (title.includes('Withdraw USD') && numericValue > currentBalance) {
            setError(`Insufficient funds. Max withdrawal: ${formatCurrency(currentBalance)}`);
            return;
        }
        
        // Basic BTC sell check
        if (title.includes('Sell Bitcoin') && numericValue > currentBalance) {
            setError(`Insufficient BTC balance. Max sell: ${currentBalance.toFixed(6)} BTC`);
            return;
        }

        onSubmit(numericValue);
        setValue('');
        setError('');
    };

    if (!isVisible) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 p-6 rounded-xl shadow-2xl w-full max-w-sm border border-yellow-500/50">
                <h2 className="text-xl font-bold text-white mb-4">{title}</h2>
                {title.includes('Buy Bitcoin') && (
                    <p className="text-sm text-gray-400 mb-3">Available USD: {formatCurrency(currentBalance)}</p>
                )}
                {title.includes('Sell Bitcoin') && (
                    <p className="text-sm text-gray-400 mb-3">Available BTC: {currentBalance.toFixed(6)}</p>
                )}
                {title.includes('Withdraw USD') && (
                    <p className="text-sm text-gray-400 mb-3">Available for Withdrawal: {formatCurrency(currentBalance)}</p>
                )}
                
                {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
                
                <label className="block text-sm font-medium text-gray-300 mb-2">{label}</label>
                <input
                    type="number"
                    step="0.01"
                    value={value}
                    onChange={(e) => {
                        setValue(e.target.value);
                        setError('');
                    }}
                    className="w-full p-2 bg-gray-700 text-white border border-gray-600 rounded-lg focus:ring-yellow-500 focus:border-yellow-500"
                    placeholder="Enter amount"
                />
                <div className="mt-6 flex justify-end space-x-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500 transition duration-150"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        className="px-4 py-2 bg-yellow-500 text-gray-900 font-semibold rounded-lg hover:bg-yellow-400 transition duration-150 shadow-md"
                    >
                        {buttonText}
                    </button>
                </div>
            </div>
        </div>
    );
};

const App = () => {
    // --- State Management ---
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [userBalance, setUserBalance] = useState({ usd: 0, btc: 0 });
    const [currentPrice, setCurrentPrice] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showModal, setShowModal] = useState(null); // 'deposit', 'withdraw', 'buy', 'sell'
    const [statusMessage, setStatusMessage] = useState(null);

    // --- Firebase Initialization and Authentication ---
    useEffect(() => {
        if (Object.keys(firebaseConfig).length === 0) {
            // This happens if the environment variables are not set up by the platform
            setCurrentPrice(68500.00); // Use simulated price
            setLoading(false);
            setError("Warning: Running in simulated mode. Database connection disabled.");
            return;
        }

        try {
            const app = initializeApp(firebaseConfig);
            const firestore = getFirestore(app);
            const authentication = getAuth(app);
            setDb(firestore);
            setAuth(authentication);

            const authenticate = async () => {
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(authentication, initialAuthToken);
                    } else {
                        await signInAnonymously(authentication);
                    }
                } catch (e) {
                     // If silent auth fails, we still allow the app to load with a simulated price
                     console.error("Auth failed, running in simulated mode.", e);
                     setCurrentPrice(68500.00); 
                     setLoading(false);
                }
            };

            const unsubscribeAuth = onAuthStateChanged(authentication, (user) => {
                if (user) {
                    setUserId(user.uid);
                    // Fetch user data if authenticated
                    if (firestore) {
                        const userDocRef = doc(firestore, `artifacts/${appId}/users/${user.uid}/wallet/balance`);
                        const unsubscribeData = onSnapshot(userDocRef, (docSnap) => {
                            if (docSnap.exists()) {
                                const data = docSnap.data();
                                setUserBalance({
                                    usd: data.usd || 0,
                                    btc: data.btc || 0,
                                });
                            } else {
                                // Initialize balance if document doesn't exist
                                setUserBalance({ usd: 0, btc: 0 });
                                setDoc(userDocRef, { usd: 1000, btc: 0 }); // Start with $1000 for convenience
                            }
                            setLoading(false);
                        }, (err) => {
                            console.error("Firestore data snapshot error:", err);
                            setError("Failed to sync user data.");
                            setLoading(false);
                        });
                        return () => unsubscribeData(); // Cleanup snapshot listener
                    }
                } else {
                    setUserId(null);
                    setLoading(false);
                }
            });

            authenticate().catch(e => {
                console.error("Initial authentication error:", e);
                setLoading(false);
            });

            return () => unsubscribeAuth();
        } catch (e) {
            console.error("Firebase initialization error:", e);
            setError("Failed to initialize Firebase services.");
            setLoading(false);
        }
    }, []);

    // --- Real-time Bitcoin Price Fetcher ---
    const fetchPrice = useCallback(async () => {
        // Use an external API for a real price if available, otherwise use a high placeholder.
        const PLACEHOLDER_PRICE = 68500.00; 
        try {
            const response = await fetch('https://api.coindesk.com/v1/bpi/currentprice/USD.json');
            if (!response.ok) throw new Error("Failed to fetch price data.");
            const data = await response.json();
            const price = data.bpi.USD.rate_float;
            setCurrentPrice(price);
        } catch (e) {
            setCurrentPrice(PLACEHOLDER_PRICE); 
        }
    }, []);

    useEffect(() => {
        fetchPrice();
        const intervalId = setInterval(fetchPrice, 15000); 
        return () => clearInterval(intervalId);
    }, [fetchPrice]);

    // --- Transaction Logic ---
    const updateBalance = async (newUsd, newBtc) => {
        if (!db || !userId) {
            // Simulation Mode Fallback: Update state directly
            setUserBalance({ usd: newUsd, btc: newBtc });
            return true;
        }

        const userDocRef = doc(db, `artifacts/${appId}/users/${userId}/wallet/balance`);
        try {
            await setDoc(userDocRef, { usd: newUsd, btc: newBtc });
            return true;
        } catch (e) {
            console.error("Transaction failed:", e);
            setError("Transaction failed to save. Please try again.");
            return false;
        }
    };

    const handleTransaction = async (type, amount) => {
        setShowModal(null);
        setError(null);
        const price = currentPrice;

        let newUsd = userBalance.usd;
        let newBtc = userBalance.btc;
        let success = false;
        let message = '';

        if (type === 'deposit') {
            newUsd += amount;
            message = `Successfully deposited ${formatCurrency(amount)} USD.`;
            success = await updateBalance(newUsd, newBtc);
        } else if (type === 'withdraw') {
            if (amount > userBalance.usd) {
                setError("Error: Insufficient USD balance for withdrawal.");
                return;
            }
            newUsd -= amount;
            message = `Successfully withdrew ${formatCurrency(amount)} USD.`;
            success = await updateBalance(newUsd, newBtc);
        } else if (type === 'buy') {
            const costUsd = amount * price;
            if (costUsd > userBalance.usd) {
                setError("Error: Insufficient USD balance to buy that much BTC.");
                return;
            }
            newUsd -= costUsd;
            newBtc += amount;
            message = `Successfully bought ${amount.toFixed(6)} BTC for ${formatCurrency(costUsd)}.`;
            success = await updateBalance(newUsd, newBtc);
        } else if (type === 'sell') {
            if (amount > userBalance.btc) {
                setError("Error: Insufficient BTC balance to sell.");
                return;
            }
            const proceedsUsd = amount * price;
            newUsd += proceedsUsd;
            newBtc -= amount;
            message = `Successfully sold ${amount.toFixed(6)} BTC for ${formatCurrency(proceedsUsd)}.`;
            success = await updateBalance(newUsd, newBtc);
        }

        if (success) {
            setStatusMessage(message);
            setTimeout(() => setStatusMessage(null), 5000);
        }
    };

    // --- Render Logic ---
    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-yellow-500 mb-4"></div>
                <p className="text-xl">Initializing Trading Terminal...</p>
            </div>
        );
    }

    const { usd, btc } = userBalance;
    const portfolioValue = usd + (btc * currentPrice);

    return (
        <div className="min-h-screen bg-gray-900 text-white font-sans flex flex-col items-center p-4 sm:p-8">
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
                * { font-family: 'Inter', sans-serif; }
            `}</style>

            <header className="w-full max-w-lg text-center mb-8">
                <h1 className="text-4xl font-extrabold text-yellow-400 mb-2">
                    <span role="img" aria-label="rocket">🚀</span> TRADE COIN <span role="img" aria-label="coin">🪙</span>
                </h1>
                <p className="text-gray-400 text-sm">Real-time Bitcoin Price Simulator</p>
            </header>

            {/* Price Card */}
            <div className="w-full max-w-lg bg-gray-800 rounded-xl shadow-lg p-6 mb-8 border-t-4 border-yellow-500">
                <div className="flex justify-between items-center mb-4">
                    <span className="text-2xl font-semibold text-gray-200">Current BTC Price</span>
                    <span className="text-3xl font-bold text-green-400">
                        {formatCurrency(currentPrice)}
                    </span>
                </div>
                <div className="text-xs text-gray-500 text-right">
                    (Updated every 15 seconds)
                </div>
            </div>

            {/* Portfolio Summary Card */}
            <div className="w-full max-w-lg bg-gray-800 rounded-xl shadow-lg p-6 mb-8 border-b-4 border-yellow-500">
                <h2 className="text-xl font-semibold text-yellow-400 mb-4">Your Portfolio Summary</h2>
                <div className="space-y-3">
                    <div className="flex justify-between text-lg">
                        <span className="text-gray-300">Total Portfolio Value:</span>
                        <span className="font-bold text-white">{formatCurrency(portfolioValue)}</span>
                    </div>
                    <hr className="border-gray-700" />
                    <div className="flex justify-between">
                        <span className="text-gray-400">USD Cash Balance:</span>
                        <span className="font-medium text-white">{formatCurrency(usd)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-400">Bitcoin (BTC) Holding:</span>
                        <span className="font-medium text-white">{btc.toFixed(6)} BTC</span>
                    </div>
                    <div className="text-xs text-gray-500 pt-2 break-all">
                        User ID: {userId || "Simulated/Offline"}
                    </div>
                </div>
            </div>

            {/* Action Buttons */}
            <div className="w-full max-w-lg grid grid-cols-2 gap-4 mb-8">
                <button
                    onClick={() => setShowModal('deposit')}
                    className="flex items-center justify-center p-3 bg-green-600 text-white font-bold rounded-lg shadow-md hover:bg-green-700 transition duration-150 transform hover:scale-[1.02]"
                >
                    Deposit USD
                </button>
                <button
                    onClick={() => setShowModal('withdraw')}
                    className="flex items-center justify-center p-3 bg-red-600 text-white font-bold rounded-lg shadow-md hover:bg-red-700 transition duration-150 transform hover:scale-[1.02]"
                >
                    Withdraw USD
                </button>
                <button
                    onClick={() => setShowModal('buy')}
                    className="flex items-center justify-center p-3 bg-yellow-500 text-gray-900 font-bold rounded-lg shadow-md hover:bg-yellow-400 transition duration-150 transform hover:scale-[1.02]"
                >
                    BUY BTC
                </button>
                <button
                    onClick={() => setShowModal('sell')}
                    className="flex items-center justify-center p-3 bg-yellow-500 text-gray-900 font-bold rounded-lg shadow-md hover:bg-yellow-400 transition duration-150 transform hover:scale-[1.02]"
                >
                    SELL BTC
                </button>
            </div>

            {/* Status Message */}
            {statusMessage && (
                <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 p-3 bg-blue-600 text-white font-medium rounded-lg shadow-xl z-50 transition-opacity duration-300">
                    {statusMessage}
                </div>
            )}
            
            {/* Error Message */}
            {error && (
                <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 p-3 bg-red-600 text-white font-medium rounded-lg shadow-xl z-50 transition-opacity duration-300">
                    {error}
                </div>
            )}

            {/* Modals */}
            <InputModal
                title="Deposit USD"
                label="USD Amount"
                buttonText="Confirm Deposit"
                currentBalance={usd}
                isVisible={showModal === 'deposit'}
                onClose={() => setShowModal(null)}
                onSubmit={(amount) => handleTransaction('deposit', amount)}
            />
            <InputModal
                title="Withdraw USD"
                label="USD Amount"
                buttonText="Confirm Withdrawal"
                currentBalance={usd}
                isVisible={showModal === 'withdraw'}
                onClose={() => setShowModal(null)}
                onSubmit={(amount) => handleTransaction('withdraw', amount)}
            />
            <InputModal
                title="Buy Bitcoin"
                label={`BTC Amount (Current Price: ${formatCurrency(currentPrice)})`}
                buttonText="Confirm Buy"
                currentBalance={usd}
                isVisible={showModal === 'buy'}
                onClose={() => setShowModal(null)}
                onSubmit={(amount) => handleTransaction('buy', amount)}
            />
            <InputModal
                title="Sell Bitcoin"
                label={`BTC Amount (Current Price: ${formatCurrency(currentPrice)})`}
                buttonText="Confirm Sell"
                currentBalance={btc}
                isVisible={showModal === 'sell'}
                onClose={() => setShowModal(null)}
                onSubmit={(amount) => handleTransaction('sell', amount)}
            />
        </div>
    );
};

export default App;

