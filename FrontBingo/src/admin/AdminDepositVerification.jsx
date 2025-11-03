import React, { useState, useEffect } from 'react';
import { apiFetch } from '../lib/api/client';

export default function AdminDepositVerification() {
    const [verifications, setVerifications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState(null);
    const [selectedVerification, setSelectedVerification] = useState(null);
    const [actionLoading, setActionLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        fetchVerifications();
        fetchStats();
    }, []);

    const fetchVerifications = async () => {
        try {
            setLoading(true);
            const response = await apiFetch('/sms-forwarder/verifications');
            if (response.success) {
                setVerifications(response.verifications);
            }
        } catch (error) {
            console.error('Error fetching verifications:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchStats = async () => {
        try {
            const response = await apiFetch('/sms-forwarder/stats');
            if (response.success) {
                setStats(response.stats);
            }
        } catch (error) {
            console.error('Error fetching stats:', error);
        }
    };

    const handleApprove = async (verificationId) => {
        try {
            setActionLoading(true);
            const response = await apiFetch(`/sms-forwarder/approve/${verificationId}`, {
                method: 'POST',
                body: { adminId: 'current_admin' } // In real app, get from auth context
            });

            if (response.success) {
                await fetchVerifications();
                await fetchStats();
                setSelectedVerification(null);
            }
        } catch (error) {
            console.error('Error approving verification:', error);
            alert('Failed to approve verification');
        } finally {
            setActionLoading(false);
        }
    };

    const handleReject = async (verificationId, reason) => {
        try {
            setActionLoading(true);
            const response = await apiFetch(`/sms-forwarder/reject/${verificationId}`, {
                method: 'POST',
                body: {
                    adminId: 'current_admin', // In real app, get from auth context
                    reason
                }
            });

            if (response.success) {
                await fetchVerifications();
                await fetchStats();
                setSelectedVerification(null);
            }
        } catch (error) {
            console.error('Error rejecting verification:', error);
            alert('Failed to reject verification');
        } finally {
            setActionLoading(false);
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'pending_review': return 'text-yellow-500';
            case 'approved': return 'text-green-500';
            case 'rejected': return 'text-red-500';
            default: return 'text-gray-500';
        }
    };

    const getConfidenceColor = (confidence) => {
        if (confidence >= 80) return 'text-green-500';
        if (confidence >= 60) return 'text-yellow-500';
        return 'text-red-500';
    };

    const baseFiltered = verifications.filter(v => {
        const q = searchQuery.trim().toLowerCase();
        if (q.length === 0) return true;
        return (
            (v.userId?.firstName || '').toLowerCase().includes(q) ||
            (v.userId?.lastName || '').toLowerCase().includes(q) ||
            (v.userId?.phone || '').toLowerCase().includes(q) ||
            String(v.amount || '').includes(q)
        );
    });
    const pendingVerifications = baseFiltered.filter(v => v.status === 'pending_review');
    const completedVerifications = baseFiltered.filter(v => v.status === 'approved' || v.status === 'rejected');

    if (loading) {
        return (
            <div className="p-6">
                <div className="animate-pulse">
                    <div className="h-8 bg-gray-300 rounded w-1/4 mb-4"></div>
                    <div className="space-y-3">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="h-16 bg-gray-300 rounded"></div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6">
            <div className="mb-6">
                <div className="flex items-end justify-between flex-wrap gap-4 mb-4">
                    <div>
                        <h1 className="text-2xl font-extrabold text-gray-900">Deposit Verifications</h1>
                        <p className="text-sm text-gray-500">Review and approve deposits matched from SMS.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search name, phone, amount"
                            className="h-10 px-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                    </div>
                </div>

                {stats && (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                        <div className="relative overflow-hidden rounded-xl p-4 bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow">
                            <div className="text-xs opacity-80">Total SMS</div>
                            <div className="text-3xl font-extrabold">{stats.sms?.total || 0}</div>
                            <div className="absolute -right-4 -bottom-4 text-7xl opacity-20">✉</div>
                        </div>
                        <div className="relative overflow-hidden rounded-xl p-4 bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow">
                            <div className="text-xs opacity-80">Matched SMS</div>
                            <div className="text-3xl font-extrabold">{stats.sms?.matched || 0}</div>
                            <div className="absolute -right-4 -bottom-4 text-7xl opacity-20">✓</div>
                        </div>
                        <div className="relative overflow-hidden rounded-xl p-4 bg-gradient-to-br from-purple-500 to-fuchsia-600 text-white shadow">
                            <div className="text-xs opacity-80">Match Rate</div>
                            <div className="text-3xl font-extrabold">{stats.sms?.matchRate?.toFixed(1) || 0}%</div>
                            <div className="absolute -right-4 -bottom-4 text-7xl opacity-20">%</div>
                        </div>
                        <div className="relative overflow-hidden rounded-xl p-4 bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow">
                            <div className="text-xs opacity-80">Pending Reviews</div>
                            <div className="text-3xl font-extrabold">{verifications.filter(v => v.status === 'pending_review').length}</div>
                            <div className="absolute -right-4 -bottom-4 text-7xl opacity-20">⌛</div>
                        </div>
                    </div>
                )}
            </div>

            {/* Pending Verifications */}
            <div className="mb-4">
                <h2 className="text-lg font-bold text-gray-800 mb-2">Pending</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {pendingVerifications.map((verification) => (
                        <div key={verification._id} className="rounded-xl bg-white shadow hover:shadow-md transition-shadow p-5">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-sm font-semibold text-gray-900">
                                        {verification.userId?.firstName} {verification.userId?.lastName}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        {verification.userId?.phone} • {verification.userId?.telegramId}
                                    </div>
                                </div>
                                <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(verification.status)} bg-gray-100 capitalize`}>
                                    {verification.status?.replace('_', ' ')}
                                </span>
                            </div>

                            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div className="sm:col-span-2">
                                    <div className="grid grid-cols-5 gap-1 text-center">
                                        <div className={`rounded-lg py-2 text-xs font-medium ${verification.matchResult?.matches?.phoneMatch ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>Phone</div>
                                        <div className={`rounded-lg py-2 text-xs font-medium ${verification.matchResult?.matches?.amountMatch ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>Amount</div>
                                        <div className={`rounded-lg py-2 text-xs font-medium ${verification.matchResult?.matches?.referenceMatch ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>Reference</div>
                                        <div className={`rounded-lg py-2 text-xs font-medium ${verification.matchResult?.matches?.timeMatch ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>Time</div>
                                        <div className={`rounded-lg py-2 text-xs font-medium ${verification.matchResult?.matches?.paymentMethodMatch ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>Method</div>
                                    </div>
                                </div>
                                <div className="sm:col-span-1 flex flex-col items-end gap-2">
                                    <div className="text-right">
                                        <div className="text-xs text-gray-500">Amount</div>
                                        <div className="text-xl font-extrabold text-green-600">ETB {verification.amount?.toFixed(2)}</div>
                                        <div className={`text-xs font-semibold ${getConfidenceColor(verification.matchResult?.confidence)}`}>{verification.matchResult?.confidence?.toFixed(1)}% confidence</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => handleApprove(verification._id)}
                                            disabled={actionLoading}
                                            className="px-3 py-2 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                                        >
                                            Approve
                                        </button>
                                        <button
                                            onClick={() => {
                                                const reason = prompt('Rejection reason:');
                                                if (reason) handleReject(verification._id, reason);
                                            }}
                                            disabled={actionLoading}
                                            className="px-3 py-2 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                                        >
                                            Reject
                                        </button>
                                        <button
                                            onClick={() => setSelectedVerification(verification)}
                                            className="px-3 py-2 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                        >
                                            Details
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                    {pendingVerifications.length === 0 && (
                        <div className="col-span-full text-sm text-gray-500">No pending verifications</div>
                    )}
                </div>
            </div>

            {/* Completed Verifications */}
            <div>
                <h2 className="text-lg font-bold text-gray-800 mb-2">Completed</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {completedVerifications.map((verification) => (
                        <div key={verification._id} className="rounded-xl bg-white shadow hover:shadow-md transition-shadow p-5">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-sm font-semibold text-gray-900">
                                        {verification.userId?.firstName} {verification.userId?.lastName}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        {verification.userId?.phone} • {verification.userId?.telegramId}
                                    </div>
                                </div>
                                <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(verification.status)} bg-gray-100 capitalize`}>
                                    {verification.status?.replace('_', ' ')}
                                </span>
                            </div>

                            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div className="sm:col-span-2">
                                    <div className="grid grid-cols-5 gap-1 text-center">
                                        <div className={`rounded-lg py-2 text-xs font-medium ${verification.matchResult?.matches?.phoneMatch ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>Phone</div>
                                        <div className={`rounded-lg py-2 text-xs font-medium ${verification.matchResult?.matches?.amountMatch ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>Amount</div>
                                        <div className={`rounded-lg py-2 text-xs font-medium ${verification.matchResult?.matches?.referenceMatch ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>Reference</div>
                                        <div className={`rounded-lg py-2 text-xs font-medium ${verification.matchResult?.matches?.timeMatch ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>Time</div>
                                        <div className={`rounded-lg py-2 text-xs font-medium ${verification.matchResult?.matches?.paymentMethodMatch ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>Method</div>
                                    </div>
                                </div>
                                <div className="sm:col-span-1 flex flex-col items-end gap-2">
                                    <div className="text-right">
                                        <div className="text-xs text-gray-500">Amount</div>
                                        <div className="text-xl font-extrabold text-green-600">ETB {verification.amount?.toFixed(2)}</div>
                                        <div className={`text-xs font-semibold ${getConfidenceColor(verification.matchResult?.confidence)}`}>{verification.matchResult?.confidence?.toFixed(1)}% confidence</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                    {completedVerifications.length === 0 && (
                        <div className="col-span-full text-sm text-gray-500">No completed verifications</div>
                    )}
                </div>
            </div>

            {/* Verification Details Modal */}
            {selectedVerification && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-medium">Verification Details</h3>
                            <button
                                onClick={() => setSelectedVerification(null)}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="space-y-4">
                            {/* User Info */}
                            <div className="bg-gray-50 p-4 rounded">
                                <h4 className="font-medium text-gray-900 mb-2">User Information</h4>
                                <p className="text-sm text-gray-600">
                                    {selectedVerification.userId?.firstName} {selectedVerification.userId?.lastName}
                                </p>
                                <p className="text-sm text-gray-600">
                                    Phone: {selectedVerification.userId?.phone}
                                </p>
                                <p className="text-sm text-gray-600">
                                    Telegram: {selectedVerification.userId?.telegramId}
                                </p>
                            </div>

                            {/* User SMS */}
                            <div className="bg-blue-50 p-4 rounded">
                                <h4 className="font-medium text-gray-900 mb-2">User SMS</h4>
                                <p className="text-sm text-gray-600 font-mono">
                                    {selectedVerification.userSMS?.message}
                                </p>
                                <div className="mt-2 text-xs text-gray-500">
                                    Amount: {selectedVerification.userSMS?.parsedData?.amount} ETB
                                </div>
                            </div>

                            {/* Receiver SMS */}
                            <div className="bg-green-50 p-4 rounded">
                                <h4 className="font-medium text-gray-900 mb-2">Receiver SMS</h4>
                                <p className="text-sm text-gray-600 font-mono">
                                    {selectedVerification.receiverSMS?.message}
                                </p>
                                <div className="mt-2 text-xs text-gray-500">
                                    Amount: {selectedVerification.receiverSMS?.parsedData?.amount} ETB
                                </div>
                            </div>

                            {/* Match Results */}
                            <div className="bg-yellow-50 p-4 rounded">
                                <h4 className="font-medium text-gray-900 mb-2">Match Analysis</h4>
                                <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                                    <div>
                                        <span className="text-gray-600">Confidence:</span>
                                        <span className={`ml-2 font-medium ${getConfidenceColor(selectedVerification.matchResult?.confidence)}`}>
                                            {selectedVerification.matchResult?.confidence?.toFixed(1)}%
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-gray-600">Score:</span>
                                        <span className="ml-2 font-medium">
                                            {selectedVerification.matchResult?.matchScore}/{selectedVerification.matchResult?.totalCriteria}
                                        </span>
                                    </div>
                                </div>

                                {/* Enhanced matching criteria display */}
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div className={`p-2 rounded ${selectedVerification.matchResult?.matches?.phoneMatch ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                        📱 Phone: {selectedVerification.matchResult?.matches?.phoneMatch ? '✅ Match' : '❌ No Match'}
                                    </div>
                                    <div className={`p-2 rounded ${selectedVerification.matchResult?.matches?.amountMatch ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                        💰 Amount: {selectedVerification.matchResult?.matches?.amountMatch ? '✅ Match' : '❌ No Match'}
                                    </div>
                                    <div className={`p-2 rounded ${selectedVerification.matchResult?.matches?.referenceMatch ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                        🏷️ Reference: {selectedVerification.matchResult?.matches?.referenceMatch ? '✅ Match' : '❌ No Match'}
                                    </div>
                                    <div className={`p-2 rounded ${selectedVerification.matchResult?.matches?.timeMatch ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                        ⏰ Time: {selectedVerification.matchResult?.matches?.timeMatch ? '✅ Match' : '❌ No Match'}
                                    </div>
                                    <div className={`p-2 rounded ${selectedVerification.matchResult?.matches?.paymentMethodMatch ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                        🏦 Method: {selectedVerification.matchResult?.matches?.paymentMethodMatch ? '✅ Match' : '❌ No Match'}
                                    </div>
                                </div>

                                {selectedVerification.matchResult?.reason && (
                                    <div className="mt-3 p-2 bg-red-100 text-red-800 rounded text-xs">
                                        <strong>Match Failure Reason:</strong> {selectedVerification.matchResult.reason}
                                    </div>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="flex justify-end space-x-3">
                                <button
                                    onClick={() => setSelectedVerification(null)}
                                    className="px-4 py-2 text-sm bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                                >
                                    Close
                                </button>
                                <button
                                    onClick={() => handleApprove(selectedVerification._id)}
                                    disabled={actionLoading}
                                    className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                                >
                                    Approve Deposit
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
