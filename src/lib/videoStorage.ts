// Video Storage using IndexedDB for large files
// 🔍 SHERLOCK HOLMES SOLUTION for unlimited video storage

interface VideoRecord {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  data: Blob;
  timestamp: number;
}

class VideoStorageDB {
  private dbName = 'LifeTracker_VideoStorage';
  private version = 1;
  private storeName = 'videos';
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      
      request.onerror = () => {
        console.error('🔍 SHERLOCK: VideoStorage IndexedDB failed to open');
        reject(request.error);
      };
      
      request.onsuccess = () => {
        this.db = request.result;
        console.log('🔍 SHERLOCK: VideoStorage IndexedDB opened successfully');
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          console.log('🔍 SHERLOCK: VideoStorage store created');
        }
      };
    });
  }

  async storeVideo(file: File): Promise<string> {
    if (!this.db) await this.init();
    
    const videoId = `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const videoRecord: VideoRecord = {
      id: videoId,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      data: file,
      timestamp: Date.now()
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.add(videoRecord);
      
      request.onsuccess = () => {
        console.log(`🔍 SHERLOCK: Video stored successfully - ID: ${videoId}, Size: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
        resolve(videoId);
      };
      
      request.onerror = () => {
        console.error('🔍 SHERLOCK: Failed to store video', request.error);
        reject(request.error);
      };
    });
  }

  async getVideo(videoId: string): Promise<VideoRecord | null> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(videoId);
      
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          console.log(`🔍 SHERLOCK: Video retrieved - ID: ${videoId}, Size: ${(result.fileSize / 1024 / 1024).toFixed(2)}MB`);
        }
        resolve(result || null);
      };
      
      request.onerror = () => {
        console.error('🔍 SHERLOCK: Failed to retrieve video', request.error);
        reject(request.error);
      };
    });
  }

  async getVideoURL(videoId: string): Promise<string | null> {
    const record = await this.getVideo(videoId);
    if (!record) return null;
    
    // Create blob URL for video playback
    const url = URL.createObjectURL(record.data);
    console.log(`🔍 SHERLOCK: Video URL created for playback - ${videoId}`);
    return url;
  }

  async deleteVideo(videoId: string): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(videoId);
      
      request.onsuccess = () => {
        console.log(`🔍 SHERLOCK: Video deleted successfully - ${videoId}`);
        resolve();
      };
      
      request.onerror = () => {
        console.error('🔍 SHERLOCK: Failed to delete video', request.error);
        reject(request.error);
      };
    });
  }

  async listVideos(): Promise<VideoRecord[]> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();
      
      request.onsuccess = () => {
        const videos = request.result;
        console.log(`🔍 SHERLOCK: Found ${videos.length} stored videos`);
        resolve(videos);
      };
      
      request.onerror = () => {
        console.error('🔍 SHERLOCK: Failed to list videos', request.error);
        reject(request.error);
      };
    });
  }

  async getStorageStats(): Promise<{ count: number; totalSize: number }> {
    const videos = await this.listVideos();
    const totalSize = videos.reduce((sum, video) => sum + video.fileSize, 0);
    
    console.log(`🔍 SHERLOCK: Storage stats - Videos: ${videos.length}, Total size: ${(totalSize / 1024 / 1024).toFixed(2)}MB`);
    
    return {
      count: videos.length,
      totalSize
    };
  }
}

// Export singleton instance
export const videoStorage = new VideoStorageDB();