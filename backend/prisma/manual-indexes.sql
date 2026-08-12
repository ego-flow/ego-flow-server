CREATE INDEX idx_videos_clip_segments ON videos USING GIN (clip_segments);
CREATE INDEX idx_videos_action_labels ON videos USING GIN (action_labels);
