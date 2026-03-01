
'use client';

import { useState } from 'react';
import { addCorporateAction } from '../actions';
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import Link from 'next/link';

export default function CorporateActionsPage() {
    const [formData, setFormData] = useState({
        date: '',
        symbol: '',
        type: 'SPLIT',
        ratio: '',
        newSymbol: '',
        description: ''
    });
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await addCorporateAction(formData);
            setMessage('Action recorded successfully!');
            setFormData({ ...formData, ratio: '', newSymbol: '', description: '' });
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            setMessage('Error: ' + errorMessage);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="container mx-auto px-4 py-8 max-w-2xl animate-fade-in-up">
            <Link href="/settings" className="inline-flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors">
                <FontAwesomeIcon icon={faArrowLeft} />
                <span>Back to Settings</span>
            </Link>
            
            <h1 className="text-xl md:text-3xl font-bold mb-2">Corporate Actions</h1>
            <p className="text-gray-400 mb-8">
                Record Splits, Bonuses, or Symbol Changes manually.
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-6 glass-card p-6 md:p-8">
                <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Date</label>
                    <input 
                        type="date" 
                        required
                        value={formData.date}
                        onChange={e => setFormData({...formData, date: e.target.value})}
                        className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Symbol</label>
                    <input 
                        type="text" 
                        required
                        placeholder="e.g. INFY"
                        value={formData.symbol}
                        onChange={e => setFormData({...formData, symbol: e.target.value.toUpperCase()})}
                        className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Type</label>
                    <select 
                        value={formData.type}
                        onChange={e => setFormData({...formData, type: e.target.value})}
                        className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                    >
                        <option value="SPLIT">Split</option>
                        <option value="BONUS">Bonus</option>
                        <option value="SYMBOL_CHANGE">Symbol Change</option>
                    </select>
                </div>

                {formData.type !== 'SYMBOL_CHANGE' && (
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">Ratio / Multiplier</label>
                        <input 
                            type="number" 
                            step="0.01"
                            placeholder="e.g. 10 for 1:10 Split"
                            value={formData.ratio}
                            onChange={e => setFormData({...formData, ratio: e.target.value})}
                            className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                        />
                        <small className="block text-xs text-gray-500 mt-1">
                            Multiplier for Quantity. E.g. Split 1:10 &rarr; Qty becomes 10x (Enter 10). Reverse Split 10:1 &rarr; Enter 0.1.
                        </small>
                    </div>
                )}

                {formData.type === 'SYMBOL_CHANGE' && (
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">New Symbol</label>
                        <input 
                            type="text" 
                            required
                            placeholder="e.g. JIOFIN"
                            value={formData.newSymbol}
                            onChange={e => setFormData({...formData, newSymbol: e.target.value.toUpperCase()})}
                            className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                        />
                    </div>
                )}

                <button 
                    type="submit" 
                    disabled={loading}
                    className="mt-4 px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {loading ? 'Processing...' : 'Submit Action'}
                </button>

                {message && (
                    <div className={`mt-2 text-sm font-medium ${message.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
                        {message}
                    </div>
                )}
            </form>
        </div>
    );
}
