import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api/client';

export default function AdminHome() {
    const [currentPost, setCurrentPost] = useState(null);
    const [form, setForm] = useState({ kind: 'image', file: null, caption: '', active: true });
    const [uploading, setUploading] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const load = async () => {
        const data = await apiFetch('/admin/posts');
        const posts = data.posts || [];
        // Find the currently active post
        const activePost = posts.find(post => post.active === true);
        setCurrentPost(activePost || null);
    };

    useEffect(() => { load(); }, []);

    const submit = async (e) => {
        e.preventDefault();
        if (!form.file) {
            alert('Please select a file to upload');
            return;
        }

        // Check if there's already an active post
        if (currentPost) {
            alert('Please delete the current active post before creating a new one.');
            return;
        }

        setUploading(true);
        try {
            const formData = new FormData();
            formData.append('kind', form.kind);
            formData.append('file', form.file);
            formData.append('caption', form.caption);
            formData.append('active', form.active);

            await apiFetch('/admin/posts', {
                method: 'POST',
                body: formData,
                headers: {} // Let the browser set Content-Type for FormData
            });

            setForm({ kind: 'image', file: null, caption: '', active: true });
            load();
        } catch (error) {
            console.error('Upload failed:', error);
            console.error('Error details:', {
                message: error.message,
                stack: error.stack,
                formData: {
                    kind: form.kind,
                    file: form.file ? {
                        name: form.file.name,
                        size: form.file.size,
                        type: form.file.type
                    } : null,
                    caption: form.caption,
                    active: form.active
                }
            });
            alert(`Upload failed: ${error.message}. Please try again.`);
        } finally {
            setUploading(false);
        }
    };

    const deleteCurrentPost = async () => {
        if (!currentPost) return;

        if (!confirm('Are you sure you want to delete the current active post?')) {
            return;
        }

        setDeleting(true);
        try {
            await apiFetch(`/admin/posts/${currentPost._id}`, {
                method: 'DELETE'
            });
            setCurrentPost(null);
            load();
        } catch (error) {
            console.error('Delete failed:', error);
            alert(`Delete failed: ${error.message}. Please try again.`);
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="admin-container admin-home-container">
            {/* Main Post Creation Area */}
            <div className="admin-card">
                <h2 className="admin-title">What is in Your Mind?</h2>

                <form onSubmit={submit} className="admin-form">
                    {/* Upload File Section */}
                    <div className="admin-form-group">
                        <label className="admin-label">
                            <span>📁</span>
                            Upload {form.kind}
                        </label>
                        <div className="admin-input-group">
                            <select
                                value={form.kind}
                                onChange={e => setForm({ ...form, kind: e.target.value, file: null })}
                                className="admin-select"
                            >
                                <option value="image">📷 Image</option>
                                <option value="video">🎥 Video</option>
                            </select>
                            <input
                                type="file"
                                accept={form.kind === 'image' ? 'image/*' : 'video/*'}
                                onChange={e => setForm({ ...form, file: e.target.files[0] })}
                                className="admin-file-input"
                                style={{ color: 'transparent' }}
                            />
                        </div>
                        {form.file && (
                            <div className="admin-file-selected">
                                <span className="text-green-400">✓</span> Selected: {form.file.name} ({(form.file.size / 1024 / 1024).toFixed(2)} MB)
                            </div>
                        )}
                    </div>

                    {/* Write Your Message Section */}
                    <div className="admin-form-group">
                        <label className="admin-label">
                            <span>✍️</span>
                            Write Your Message
                        </label>
                        <textarea
                            value={form.caption}
                            onChange={e => setForm({ ...form, caption: e.target.value })}
                            placeholder="Write your announcement or message here..."
                            rows={4}
                            className="admin-textarea"
                        />
                    </div>

                    {/* Active Toggle */}
                    <div className="admin-checkbox-group">
                        <input
                            id="active"
                            type="checkbox"
                            checked={form.active}
                            onChange={e => setForm({ ...form, active: e.target.checked })}
                            className="admin-checkbox"
                        />
                        <label htmlFor="active" className="admin-checkbox-label">
                            <span>🔘</span>
                            Make this post active
                        </label>
                    </div>

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={uploading || !form.file}
                        className="admin-button"
                    >
                        {uploading ? (
                            <span className="admin-button-content">
                                <div className="admin-spinner"></div>
                                Uploading...
                            </span>
                        ) : (
                            <span className="admin-button-content">
                                <span>🚀</span>
                                Post Announcement
                            </span>
                        )}
                    </button>
                </form>
            </div>

            {/* Current Active Post */}
            <div className="admin-posts-section">
                <h3 className="admin-section-title">
                    <span>📋</span>
                    Current Active Post
                </h3>
                <div className="admin-posts-list">
                    {currentPost ? (
                        <div className="admin-post-card">
                            <div className="admin-post-header">
                                <div className="admin-post-type">
                                    <span>{currentPost.kind === 'image' ? '📷' : '🎥'}</span>
                                    {currentPost.kind.toUpperCase()}
                                </div>
                                <div className="admin-post-date">
                                    {new Date(currentPost.createdAt).toLocaleString()}
                                </div>
                            </div>
                            <div className="admin-post-file">
                                📁 {currentPost.url || currentPost.filename || 'File uploaded'}
                            </div>
                            {currentPost.caption ? (
                                <div className="admin-post-caption">
                                    💬 {currentPost.caption}
                                </div>
                            ) : null}
                            <div className="admin-post-actions">
                                <span className="admin-status-badge admin-status-active">
                                    ✅ Currently Active
                                </span>
                                <button
                                    onClick={deleteCurrentPost}
                                    disabled={deleting}
                                    className="admin-delete-button"
                                >
                                    {deleting ? (
                                        <span className="admin-button-content">
                                            <div className="admin-spinner"></div>
                                            Deleting...
                                        </span>
                                    ) : (
                                        <span className="admin-button-content">
                                            <span>🗑️</span>
                                            Delete Post
                                        </span>
                                    )}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="admin-empty-state">
                            <div className="admin-empty-icon">📝</div>
                            <div className="admin-empty-title">No active post</div>
                            <div className="admin-empty-subtitle">Create your first announcement!</div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
