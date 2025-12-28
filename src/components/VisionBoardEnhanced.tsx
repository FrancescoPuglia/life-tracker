"use client";

import { useState, useEffect, useRef } from 'react';
import { useAuthContext } from '@/providers/AuthProvider';
import { db } from '@/lib/database';
import { ArrowLeft } from 'lucide-react';
import { videoStorage } from '@/lib/videoStorage';

// ============================================================================
// TYPES
// ============================================================================

interface Vision {
  id: string;
  title: string;
  description: string;
  category: 'successo' | 'salute' | 'relazioni' | 'ricchezza' | 'crescita';
  date: string;
  media?: string;
  mediaType?: 'image' | 'video';
  audio?: string;
  userId: string;
  domainId: string;
}

interface BoardSettings {
  title: string;
  subtitle: string;
  startDate: string;
  userId: string;
  domainId: string;
}

interface Quote {
  text: string;
  author: string;
}

// ============================================================================
// VISION BOARD ENHANCED COMPONENT
// ============================================================================

interface VisionBoardEnhancedProps {
  onBack?: () => void;
  className?: string;
}

export default function VisionBoardEnhanced({ onBack, className = "" }: VisionBoardEnhancedProps) {
  const { user } = useAuthContext();
  const [visions, setVisions] = useState<Vision[]>([]);
  const [boardSettings, setBoardSettings] = useState<BoardSettings>({
    title: 'VISION BOARD',
    subtitle: 'Manifesta il tuo destino straordinario',
    startDate: new Date().toISOString(),
    userId: user?.uid || 'guest',
    domainId: 'default'
  });
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentCategory, setCurrentCategory] = useState<Vision['category']>('successo');
  const [currentQuote, setCurrentQuote] = useState<Quote>({ text: '', author: '' });
  const [immersiveVision, setImmersiveVision] = useState<Vision | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'successo' as Vision['category']
  });
  
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string>('');
  const [isUploadingMedia, setIsUploadingMedia] = useState<boolean>(false);
  const [audioPreview, setAudioPreview] = useState<string>('');
  const [indexedDBVideoURL, setIndexedDBVideoURL] = useState<string>('');
  
  const starsRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<HTMLDivElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const immersiveAudioRef = useRef<HTMLAudioElement>(null);

  const quotes: Quote[] = [
    { text: "Ciò che pensi, diventi. Ciò che senti, attrai. Ciò che immagini, crei.", author: "Buddha" },
    { text: "L'universo non ti dà ciò che vuoi. Ti dà ciò che sei.", author: "Wayne Dyer" },
    { text: "Ogni pensiero che pensiamo sta creando il nostro futuro.", author: "Louise Hay" },
    { text: "Il segreto del cambiamento è concentrare tutta la tua energia non nel combattere il vecchio, ma nel costruire il nuovo.", author: "Socrate" },
    { text: "Visualizza questa cosa che vuoi. Vedila, sentila, credici. Fai il tuo piano mentale e inizia a costruire.", author: "Robert Collier" },
    { text: "Tutto ciò di cui hai bisogno è già dentro di te.", author: "Rumi" },
    { text: "Non sei una goccia nell'oceano. Sei l'intero oceano in una goccia.", author: "Rumi" },
    { text: "La tua mente è un giardino. I tuoi pensieri sono i semi. Puoi coltivare fiori o erbacce.", author: "Anonimo" }
  ];

  // ========== EFFECTS ==========

  useEffect(() => {
    if (user) {
      loadVisions();
      loadBoardSettings();
      setRandomQuote();
      createStars();
      createParticles();
    }
  }, [user]);

  // ESC key listener for closing immersive mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        console.log('🔍 SHERLOCK: ESC key pressed, closing immersive');
        if (immersiveVision) {
          closeImmersive();
        } else if (isModalOpen) {
          handleCloseModal();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [immersiveVision, isModalOpen]);

  // ========== FIREBASE INTEGRATION ==========

  const loadVisions = async () => {
    if (!user) return;
    
    try {
      console.log('🔍 SHERLOCK: Loading visions FROM LOCAL STORAGE ONLY...');
      
      // BYPASS FIRESTORE COMPLETELY - Use only localStorage for visions
      const storageKey = `vision_board_${user.uid}`;
      const storedData = localStorage.getItem(storageKey);
      
      if (storedData) {
        try {
          const localVisions = JSON.parse(storedData);
          setVisions(localVisions);
          console.log(`🔍 SHERLOCK: Loaded ${localVisions.length} visions from localStorage`);
          return;
        } catch (error) {
          console.error('🔍 SHERLOCK: localStorage parse error, clearing:', error);
          localStorage.removeItem(storageKey);
        }
      }
      
      // If no local data, start with empty array
      setVisions([]);
      console.log('🔍 SHERLOCK: No local visions found, starting fresh');
      
    } catch (error) {
      console.error('🔍 SHERLOCK: Error loading visions (using fallback):', error);
      setVisions([]); // Fallback to empty array
    }
  };

  const loadBoardSettings = async () => {
    if (!user) return;
    
    try {
      console.log('🔍 SHERLOCK: Skipping Firestore board settings, using defaults...');
      
      // BYPASS FIRESTORE COMPLETELY - Use default settings
      setBoardSettings({
        title: 'VISION BOARD',
        subtitle: 'Manifesta il tuo destino straordinario',
        startDate: new Date().toISOString(),
        userId: user.uid,
        domainId: 'default'
      });
      
      console.log('🔍 SHERLOCK: Board settings loaded from defaults (no Firestore)');
    } catch (error) {
      console.error('🔍 SHERLOCK: Failed to set default board settings:', error);
    }
  };

  const saveVision = async (visionData: Omit<Vision, 'id' | 'userId' | 'domainId'>) => {
    if (!user) return;

    try {
      console.log('🔍 SHERLOCK: Saving vision TO LOCAL STORAGE ONLY...');

      // Create vision with unique ID
      const newVision: Vision = {
        id: `vision_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        title: visionData.title,
        description: visionData.description,
        category: visionData.category,
        date: new Date().toISOString(),
        media: mediaPreview || visionData.media,
        mediaType: visionData.mediaType,
        audio: audioPreview || (audioFile ? 'uploaded' : undefined),
        userId: user.uid,
        domainId: 'default'
      };

      // Handle media/audio processing for localStorage
      if (mediaFile && mediaPreview) {
        console.log('🔍 SHERLOCK: Processing media for localStorage');
        if (mediaPreview.startsWith('INDEXEDDB:')) {
          // Keep IndexedDB reference as is
          newVision.media = mediaPreview;
        } else {
          // Direct base64 storage in localStorage (no size limit like Firestore)
          newVision.media = mediaPreview;
        }
      }

      if (audioFile && audioPreview) {
        console.log('🔍 SHERLOCK: Processing audio for localStorage');
        newVision.audio = audioPreview;
      }

      // Save to localStorage instead of Firestore
      const storageKey = `vision_board_${user.uid}`;
      const existingVisions = visions; // Current state
      const updatedVisions = [newVision, ...existingVisions];

      // Save to localStorage
      localStorage.setItem(storageKey, JSON.stringify(updatedVisions));
      
      // Update local state
      setVisions(updatedVisions);
      
      console.log('🔍 SHERLOCK: Vision saved successfully to localStorage!');
      showToast();
      
    } catch (error: any) {
      console.error('🔍 SHERLOCK: Failed to save vision to localStorage:', error);
      alert('❌ Errore nel salvare la visione. Riprova.');
      throw error;
    }
  };

  const deleteVision = async (visionId: string) => {
    if (!user) return;
    
    try {
      console.log('🔍 SHERLOCK: Deleting vision from localStorage...');
      
      // Remove from local state
      const updatedVisions = visions.filter(v => v.id !== visionId);
      setVisions(updatedVisions);
      
      // Update localStorage
      const storageKey = `vision_board_${user.uid}`;
      localStorage.setItem(storageKey, JSON.stringify(updatedVisions));
      
      console.log('🔍 SHERLOCK: Vision deleted successfully from localStorage!');
      
      // Show success toast
      const toast = document.getElementById('deleteToast');
      if (toast) {
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
      }
    } catch (error) {
      console.error('🔍 SHERLOCK: Failed to delete vision from localStorage:', error);
      alert('❌ Errore nell\'eliminazione. Riprova.');
    }
  };

  // ========== UTILITY FUNCTIONS ==========

  const setRandomQuote = () => {
    const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
    setCurrentQuote(randomQuote);
  };

  const createStars = () => {
    if (!starsRef.current) return;
    
    starsRef.current.innerHTML = '';
    for (let i = 0; i < 100; i++) {
      const star = document.createElement('div');
      star.className = 'star';
      star.style.left = Math.random() * 100 + '%';
      star.style.top = Math.random() * 100 + '%';
      star.style.setProperty('--duration', (Math.random() * 3 + 2) + 's');
      star.style.setProperty('--opacity', (Math.random() * 0.8 + 0.2).toString());
      star.style.animationDelay = Math.random() * 5 + 's';
      starsRef.current.appendChild(star);
    }
  };

  const createParticles = () => {
    if (!particlesRef.current) return;
    
    particlesRef.current.innerHTML = '';
    for (let i = 0; i < 15; i++) {
      const particle = document.createElement('div');
      particle.className = 'particle';
      particle.style.left = Math.random() * 100 + '%';
      particle.style.animationDelay = Math.random() * 8 + 's';
      particle.style.animationDuration = (Math.random() * 4 + 6) + 's';
      particlesRef.current.appendChild(particle);
    }
  };

  const createImmersiveParticles = () => {
    const container = document.getElementById('immersiveParticles');
    if (!container) return;
    
    container.innerHTML = '';
    for (let i = 0; i < 50; i++) {
      const particle = document.createElement('div');
      particle.className = 'immersive-particle';
      particle.style.left = Math.random() * 100 + '%';
      particle.style.top = Math.random() * 100 + '%';
      particle.style.animationDelay = Math.random() * 6 + 's';
      particle.style.animationDuration = (Math.random() * 4 + 4) + 's';
      container.appendChild(particle);
    }
  };

  const showToast = () => {
    const toast = document.getElementById('toast');
    if (toast) {
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 3000);
    }
  };

  // ========== EVENT HANDLERS ==========

  const handleOpenModal = () => {
    setIsModalOpen(true);
    document.body.style.overflow = 'hidden';
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    document.body.style.overflow = '';
    setFormData({ title: '', description: '', category: 'successo' });
    setMediaFile(null);
    setAudioFile(null);
    setMediaPreview('');
    setAudioPreview('');
  };

  const handleSubmit = async () => {
    if (!formData.title.trim()) {
      alert('⚠️ Inserisci un titolo per la tua visione!');
      return;
    }

    try {
      await saveVision({
        title: formData.title,
        description: formData.description,
        category: formData.category,
        date: new Date().toISOString(),
        media: mediaPreview,
        mediaType: mediaFile?.type.startsWith('image/') ? 'image' : 'video'
      });

      handleCloseModal();
      // Toast will be shown by saveVision function
    } catch (error) {
      console.error('Error saving vision:', error);
      alert('❌ Errore nel salvare la visione. Riprova.');
    }
  };

  const compressImage = (file: File, quality: number = 0.7): Promise<string> => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      const img = new Image();
      
      img.onload = () => {
        // Calculate new dimensions (max 800px width/height)
        const maxDimension = 800;
        const scale = Math.min(maxDimension / img.width, maxDimension / img.height, 1);
        
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      };
      
      img.src = URL.createObjectURL(file);
    });
  };


  const handleMediaFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    console.log(`🔍 SHERLOCK: Starting file processing...`);
    setIsUploadingMedia(true);
    
    try {
      const sizeInMB = file.size / (1024 * 1024);
      console.log(`🔍 SHERLOCK: Processing file: ${file.name}, Size: ${sizeInMB.toFixed(2)}MB`);
      
      setMediaFile(file);
    
    if (file.type.startsWith('image/') && sizeInMB > 0.8) {
      // Compress image
      console.log('🔍 SHERLOCK: Compressing image...');
      const compressedImage = await compressImage(file, 0.6);
      setMediaPreview(compressedImage);
      
      const compressedSize = compressedImage.length / (1024 * 1024);
      console.log(`🔍 SHERLOCK: Image compressed to ${compressedSize.toFixed(2)}MB`);
      setIsUploadingMedia(false);
      
    } else if (file.type.startsWith('video/')) {
      // Smart video handling: IndexedDB for large files, base64 for small ones
      console.log('🔍 SHERLOCK: Processing video intelligently...');
      const fileSizeInMB = file.size / (1024 * 1024);
      
      if (fileSizeInMB > 1) {
        // Large videos: Store in IndexedDB
        console.log(`🔍 SHERLOCK: Large video (${fileSizeInMB.toFixed(2)}MB) - storing in IndexedDB...`);
        try {
          const videoId = await videoStorage.storeVideo(file);
          setMediaPreview(`INDEXEDDB:${videoId}`); // Store IndexedDB reference
          console.log(`🔍 SHERLOCK: Video stored in IndexedDB successfully! ID: ${videoId}`);
          setIsUploadingMedia(false);
        } catch (error) {
          console.error('🔍 SHERLOCK: IndexedDB storage failed:', error);
          alert('❌ Errore nel salvare il video. Prova con un file più piccolo.');
          setIsUploadingMedia(false);
        }
      } else {
        // Small videos: Use base64 as before
        console.log(`🔍 SHERLOCK: Small video (${fileSizeInMB.toFixed(2)}MB) - using base64...`);
        const reader = new FileReader();
        reader.onload = (e) => {
          const result = e.target?.result as string;
          setMediaPreview(result);
          console.log(`🔍 SHERLOCK: Small video processing completed!`);
          setIsUploadingMedia(false);
        };
        reader.onerror = () => {
          console.error('🔍 SHERLOCK: Video processing failed!');
          setIsUploadingMedia(false);
          alert('❌ Errore nel processare il video. Prova con un file più piccolo.');
        };
        reader.readAsDataURL(file);
      }
    } else {
      // Small file, process normally
      console.log('🔍 SHERLOCK: Processing small file normally...');
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setMediaPreview(result);
        console.log('🔍 SHERLOCK: File processing completed successfully!');
        setIsUploadingMedia(false);
      };
      reader.onerror = () => {
        console.error('🔍 SHERLOCK: FileReader error!');
        setIsUploadingMedia(false);
      };
      reader.readAsDataURL(file);
    }
    
    } catch (error) {
      console.error('🔍 SHERLOCK: Error in handleMediaFileChange:', error);
      alert(`❌ Errore nel processare il file: ${error}`);
      setIsUploadingMedia(false);
    }
  };

  const handleAudioFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAudioFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        setAudioPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const openImmersive = async (vision: Vision) => {
    // If it's an IndexedDB video, load the URL first
    if (vision.media?.startsWith('INDEXEDDB:')) {
      const videoId = vision.media.replace('INDEXEDDB:', '');
      console.log(`🔍 SHERLOCK: Loading IndexedDB video: ${videoId}`);
      try {
        const videoURL = await videoStorage.getVideoURL(videoId);
        if (videoURL) {
          setIndexedDBVideoURL(videoURL);
          console.log('🔍 SHERLOCK: IndexedDB video URL loaded successfully');
        } else {
          console.error('🔍 SHERLOCK: Failed to load IndexedDB video');
          alert('❌ Errore nel caricare il video. Il file potrebbe essere stato eliminato.');
          return;
        }
      } catch (error) {
        console.error('🔍 SHERLOCK: IndexedDB video loading failed:', error);
        alert('❌ Errore nel caricare il video dal storage locale.');
        return;
      }
    } else {
      setIndexedDBVideoURL(''); // Clear previous IndexedDB URL
    }

    setImmersiveVision(vision);
    createImmersiveParticles();
    document.body.style.overflow = 'hidden';
    
    // If vision has audio, play it
    if (vision.audio && vision.audio.startsWith('data:')) {
      setTimeout(() => {
        if (immersiveAudioRef.current) {
          immersiveAudioRef.current.src = vision.audio || '';
          immersiveAudioRef.current.play().catch(e => {
            console.log('Audio autoplay blocked:', e);
          });
        }
      }, 500);
    }
  };

  const closeImmersive = () => {
    console.log('🔍 SHERLOCK: closeImmersive called!');
    
    // Clean up IndexedDB video URL
    if (indexedDBVideoURL) {
      URL.revokeObjectURL(indexedDBVideoURL);
      setIndexedDBVideoURL('');
      console.log('🔍 SHERLOCK: IndexedDB video URL cleaned up');
    }
    
    setImmersiveVision(null);
    if (immersiveAudioRef.current) {
      immersiveAudioRef.current.pause();
      immersiveAudioRef.current.src = '';
    }
    document.body.style.overflow = '';
    console.log('🔍 SHERLOCK: Immersive closed successfully!');
  };

  const formatDate = (dateString: string) => {
    const d = new Date(dateString);
    const months = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  };

  // If user not logged in, show login message
  if (!user) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center text-white">
          <h2 className="text-2xl font-bold mb-4">Accesso Richiesto</h2>
          <p>Effettua il login per accedere alla tua Vision Board</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* CSS Styles */}
      <style jsx>{`
        .cosmic-bg {
          position: fixed;
          top: 0; left: 0;
          width: 100%; height: 100%;
          z-index: -2;
          background: 
            radial-gradient(ellipse at 20% 20%, rgba(139, 69, 255, 0.15) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 80%, rgba(212, 175, 55, 0.1) 0%, transparent 50%),
            radial-gradient(ellipse at 50% 50%, rgba(26, 10, 46, 0.8) 0%, #0a0a0f 70%);
        }

        .star {
          position: absolute;
          width: 2px; height: 2px;
          background: #f4e4bc;
          border-radius: 50%;
          animation: twinkle var(--duration) ease-in-out infinite;
          opacity: 0;
        }

        @keyframes twinkle {
          0%, 100% { opacity: 0; transform: scale(0.5); }
          50% { opacity: var(--opacity); transform: scale(1); }
        }

        .particle {
          position: absolute;
          width: 4px; height: 4px;
          background: #d4af37;
          border-radius: 50%;
          opacity: 0;
          animation: float-up 8s ease-in-out infinite;
          box-shadow: 0 0 10px #d4af37, 0 0 20px #d4af37;
        }

        @keyframes float-up {
          0% { transform: translateY(100vh) scale(0); opacity: 0; }
          10% { opacity: 0.8; }
          90% { opacity: 0.8; }
          100% { transform: translateY(-100px) scale(1); opacity: 0; }
        }

        .immersive-particle {
          position: absolute;
          width: 3px; height: 3px;
          background: #d4af37;
          border-radius: 50%;
          box-shadow: 0 0 10px #d4af37, 0 0 20px #d4af37;
          animation: immersive-float 6s ease-in-out infinite;
        }

        @keyframes immersive-float {
          0%, 100% { transform: translateY(0) scale(0); opacity: 0; }
          50% { transform: translateY(-100px) scale(1); opacity: 0.8; }
        }

        .toast {
          position: fixed;
          bottom: 100px; left: 50%;
          transform: translateX(-50%) translateY(100px);
          padding: 20px 40px;
          background: linear-gradient(135deg, rgba(0, 255, 136, 0.2), rgba(0, 255, 136, 0.05));
          border: 1px solid #00ff88;
          border-radius: 15px;
          color: #00ff88;
          z-index: 5000;
          opacity: 0;
          transition: all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }

        .toast.show {
          transform: translateX(-50%) translateY(0);
          opacity: 1;
        }

        .sacred-geometry {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 500px; height: 500px;
          opacity: 0.05;
          animation: rotate-slow 120s linear infinite;
        }

        @keyframes rotate-slow {
          from { transform: translate(-50%, -50%) rotate(0deg); }
          to { transform: translate(-50%, -50%) rotate(360deg); }
        }

        .main-title {
          font-family: serif;
          font-size: clamp(2.5rem, 8vw, 5rem);
          font-weight: 700;
          letter-spacing: 0.3em;
          text-transform: uppercase;
          background: linear-gradient(135deg, #f4e4bc 0%, #d4af37 50%, #8b6914 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 20px;
          animation: glow-pulse 4s ease-in-out infinite;
        }

        @keyframes glow-pulse {
          0%, 100% { filter: drop-shadow(0 0 20px rgba(212, 175, 55, 0.5)); }
          50% { filter: drop-shadow(0 0 40px rgba(212, 175, 55, 0.8)); }
        }
      `}</style>

      <div className={`min-h-screen bg-gray-900 text-white relative overflow-hidden ${className}`}>
        {/* Cosmic Background */}
        <div className="cosmic-bg"></div>
        <div className="stars-container" ref={starsRef}></div>
        <div className="particles-container" ref={particlesRef}></div>

        {/* Navigation Header */}
        {onBack && (
          <div className="relative z-10 p-6">
            <button
              onClick={onBack}
              className="flex items-center gap-3 px-4 py-2 bg-white/10 backdrop-blur-md rounded-lg border border-white/20 text-white hover:bg-white/20 transition-all duration-300"
            >
              <ArrowLeft className="h-5 w-5" />
              <span>Torna alla Dashboard</span>
            </button>
          </div>
        )}

        {/* Header */}
        <header className="relative z-10 p-16 text-center">
          <svg className="sacred-geometry" viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="80" fill="none" stroke="currentColor" strokeWidth="0.5"/>
            <circle cx="100" cy="100" r="60" fill="none" stroke="currentColor" strokeWidth="0.5"/>
            <circle cx="100" cy="100" r="40" fill="none" stroke="currentColor" strokeWidth="0.5"/>
            <polygon points="100,20 180,140 20,140" fill="none" stroke="currentColor" strokeWidth="0.5"/>
            <polygon points="100,180 20,60 180,60" fill="none" stroke="currentColor" strokeWidth="0.5"/>
          </svg>
          
          <div className="relative z-10">
            <h1 className="main-title">{boardSettings.title}</h1>
            <p className="text-xl italic text-yellow-200/70 letter-spacing-wider">
              {boardSettings.subtitle}
            </p>
          </div>

          <div className="flex justify-center items-center gap-6 mt-8">
            <div className="w-32 h-px bg-gradient-to-r from-transparent via-yellow-400 to-transparent"></div>
            <div className="w-3 h-3 bg-yellow-400 transform rotate-45 animate-pulse"></div>
            <div className="w-32 h-px bg-gradient-to-r from-transparent via-yellow-400 to-transparent"></div>
          </div>

          <div className="flex justify-center gap-16 mt-12">
            <div className="text-center p-6 bg-white/5 backdrop-blur-md rounded-lg border border-white/20">
              <div className="text-3xl font-bold text-yellow-400">{visions.length}</div>
              <div className="text-sm uppercase tracking-wider text-gray-300">Visioni Create</div>
            </div>
            <div className="text-center p-6 bg-white/5 backdrop-blur-md rounded-lg border border-white/20">
              <div className="text-3xl font-bold text-yellow-400">{visions.filter(v => v.media || v.audio).length}</div>
              <div className="text-sm uppercase tracking-wider text-gray-300">Media Caricati</div>
            </div>
            <div className="text-center p-6 bg-white/5 backdrop-blur-md rounded-lg border border-white/20">
              <div className="text-3xl font-bold text-yellow-400">1</div>
              <div className="text-sm uppercase tracking-wider text-gray-300">Giorni di Pratica</div>
            </div>
          </div>
        </header>

        {/* Daily Quote */}
        <div className="max-w-4xl mx-auto mb-12 p-8 bg-white/5 backdrop-blur-md rounded-lg border border-white/20">
          <p className="text-xl italic leading-relaxed text-center text-yellow-100">{currentQuote.text}</p>
          <p className="text-center mt-4 text-sm text-gray-400">— {currentQuote.author}</p>
        </div>

        {/* Vision Board */}
        <main className="relative z-10 px-8 pb-20">
          {visions.length === 0 ? (
            <div className="text-center py-20">
              <div className="w-24 h-24 mx-auto mb-6 bg-gradient-to-br from-purple-500 to-yellow-500 rounded-full flex items-center justify-center">
                <span className="text-3xl">✧</span>
              </div>
              <h2 className="text-2xl font-bold mb-4">Inizia a Manifestare</h2>
              <p className="text-gray-400 max-w-md mx-auto">Clicca il pulsante ✦ per aggiungere la tua prima visione.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {visions.map((vision, index) => (
                <div
                  key={vision.id}
                  className="group relative bg-white/10 backdrop-blur-md rounded-xl overflow-hidden border border-white/20 hover:border-yellow-400/50 transition-all duration-500 cursor-pointer transform hover:scale-105 hover:shadow-2xl hover:shadow-yellow-400/20"
                  onClick={() => openImmersive(vision)}
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  {/* Delete Button - Now always visible */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm('🗑️ Eliminare questa visione?\n\nQuesta azione non può essere annullata.')) {
                        deleteVision(vision.id);
                      }
                    }}
                    className="absolute top-3 right-3 z-20 w-8 h-8 bg-red-600/90 hover:bg-red-700 rounded-full flex items-center justify-center text-white font-bold transition-all duration-300 hover:scale-110 shadow-lg"
                    title="Elimina questa visione"
                  >
                    ×
                  </button>

                  {/* Media Content */}
                  {vision.media ? (
                    <div className="relative h-48 bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center">
                      {vision.mediaType === 'image' ? (
                        <div className="text-4xl opacity-50">📷</div>
                      ) : (
                        <div className="text-4xl opacity-50">🎬</div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent"></div>
                      <span className="absolute top-3 right-3 px-2 py-1 bg-black/70 rounded text-xs text-yellow-400">
                        {vision.mediaType === 'image' ? '📷 Foto' : '🎬 Video'}
                      </span>
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="w-16 h-16 bg-yellow-400/20 rounded-full flex items-center justify-center border-2 border-yellow-400">
                          <div className="w-0 h-0 border-l-[12px] border-l-yellow-400 border-t-[8px] border-t-transparent border-b-[8px] border-b-transparent ml-1"></div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="h-48 bg-gradient-to-br from-yellow-500/20 to-orange-500/20 flex flex-col justify-center p-6">
                      <div className="text-2xl mb-2 opacity-30">✧</div>
                      <blockquote className="text-lg font-medium italic leading-relaxed text-white">
                        "{vision.description || vision.title}"
                      </blockquote>
                    </div>
                  )}

                  {/* Content */}
                  <div className="p-6">
                    <h3 className="text-lg font-bold text-yellow-400 mb-2">{vision.title}</h3>
                    {vision.description && (
                      <p className="text-gray-300 text-sm mb-3 line-clamp-2">
                        {vision.description.length > 100 ? vision.description.substring(0, 100) + '...' : vision.description}
                      </p>
                    )}
                    <div className="text-xs text-gray-500">{formatDate(vision.date)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>

        {/* Floating Add Button */}
        <button
          onClick={handleOpenModal}
          className="fixed bottom-8 right-8 w-16 h-16 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center text-2xl text-black hover:scale-110 transition-transform shadow-lg shadow-yellow-400/30 z-50"
        >
          ✦
        </button>

        {/* Add Vision Modal */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-50 p-4">
            <div className="bg-gray-900/95 backdrop-blur-md rounded-2xl border border-yellow-400/30 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-6 border-b border-yellow-400/20">
                <h2 className="text-2xl font-bold text-yellow-400">✧ Nuova Visione ✧</h2>
                <button
                  onClick={handleCloseModal}
                  className="text-gray-400 hover:text-white text-2xl"
                >
                  ×
                </button>
              </div>

              <div className="p-6 space-y-6">
                {/* Title */}
                <div>
                  <label className="block text-yellow-400 font-medium mb-2 uppercase tracking-wider text-sm">
                    Titolo della Visione
                  </label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="Es: Il mio successo nel 2025"
                    className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-yellow-400 focus:outline-none transition-colors"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-yellow-400 font-medium mb-2 uppercase tracking-wider text-sm">
                    Descrizione / Affermazione
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Descrivi la tua visione..."
                    rows={4}
                    className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-yellow-400 focus:outline-none transition-colors resize-none"
                  />
                </div>

                {/* Category */}
                <div>
                  <label className="block text-yellow-400 font-medium mb-2 uppercase tracking-wider text-sm">
                    Categoria
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: 'successo', label: '✦ Successo' },
                      { id: 'salute', label: '♡ Salute' },
                      { id: 'relazioni', label: '❋ Relazioni' },
                      { id: 'ricchezza', label: '◈ Ricchezza' },
                      { id: 'crescita', label: '⬡ Crescita' }
                    ].map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setFormData({ ...formData, category: cat.id as Vision['category'] })}
                        className={`px-4 py-2 rounded-full border transition-colors ${
                          formData.category === cat.id
                            ? 'border-yellow-400 bg-yellow-400/20 text-yellow-400'
                            : 'border-white/20 text-gray-300 hover:border-yellow-400/50'
                        }`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Media Upload */}
                <div>
                  <label className="block text-yellow-400 font-medium mb-2 uppercase tracking-wider text-sm">
                    Immagine o Video
                  </label>
                  <div 
                    className="border-2 border-dashed border-white/20 rounded-lg p-8 text-center hover:border-yellow-400/50 transition-colors cursor-pointer relative"
                    onClick={() => !isUploadingMedia && mediaInputRef.current?.click()}
                  >
                    {isUploadingMedia ? (
                      <>
                        <div className="animate-spin text-3xl mb-3">⟳</div>
                        <div className="text-yellow-400 mb-1">🔍 SHERLOCK: Processando file...</div>
                        <div className="text-gray-400 text-sm">Attendere prego...</div>
                      </>
                    ) : (
                      <>
                        <div className="text-3xl mb-3">◇</div>
                        <div className="text-white mb-1">Trascina qui o clicca per caricare</div>
                        <div className="text-gray-400 text-sm">JPG, PNG, GIF, MP4, WebM</div>
                      </>
                    )}
                    <input
                      ref={mediaInputRef}
                      type="file"
                      accept="image/*,video/*"
                      onChange={handleMediaFileChange}
                      className="hidden"
                    />
                  </div>
                  {mediaPreview && (
                    <div className="mt-3 p-3 bg-black/30 rounded-lg">
                      {mediaFile?.type.startsWith('image/') ? (
                        <img src={mediaPreview} alt="Preview" className="max-w-full max-h-48 rounded" />
                      ) : (
                        <video src={mediaPreview} controls className="max-w-full max-h-48 rounded" />
                      )}
                    </div>
                  )}
                </div>

                {/* Audio Upload */}
                <div>
                  <label className="block text-yellow-400 font-medium mb-2 uppercase tracking-wider text-sm">
                    Audio
                  </label>
                  <div 
                    className="border-2 border-dashed border-white/20 rounded-lg p-8 text-center hover:border-yellow-400/50 transition-colors cursor-pointer relative"
                    onClick={() => audioInputRef.current?.click()}
                  >
                    <div className="text-3xl mb-3">♪</div>
                    <div className="text-white mb-1">Carica un file audio</div>
                    <div className="text-gray-400 text-sm">MP3, WAV, OGG</div>
                    <input
                      ref={audioInputRef}
                      type="file"
                      accept="audio/*"
                      onChange={handleAudioFileChange}
                      className="hidden"
                    />
                  </div>
                  {audioPreview && (
                    <div className="mt-3 p-3 bg-black/30 rounded-lg">
                      <audio src={audioPreview} controls className="w-full" />
                    </div>
                  )}
                </div>

                {/* Submit Button */}
                <button
                  onClick={handleSubmit}
                  className="w-full py-4 bg-gradient-to-r from-yellow-600 to-orange-600 text-black font-bold text-lg rounded-lg hover:from-yellow-500 hover:to-orange-500 transition-all transform hover:scale-105 uppercase tracking-wider"
                >
                  ✧ Manifesta Questa Visione ✧
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Immersive Experience */}
        {immersiveVision && (
          <div 
            className="fixed inset-0 bg-black z-50 flex items-center justify-center"
            onClick={(e) => {
              // Close if clicking on the background (not on video/image)
              if (e.target === e.currentTarget) {
                console.log('🔍 SHERLOCK: Background clicked, closing immersive');
                closeImmersive();
              }
            }}
          >
            <div className="absolute inset-0" id="immersiveParticles"></div>
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-black/30 to-transparent"></div>
            
            <div className="absolute top-8 left-1/2 transform -translate-x-1/2 text-gray-400 text-sm uppercase tracking-widest animate-pulse">
              Respira... Visualizza... Manifesta
            </div>
            
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('🔍 SHERLOCK: Close button clicked!');
                closeImmersive();
              }}
              className="absolute top-8 right-8 w-12 h-12 bg-white/10 backdrop-blur-md rounded-full border-2 border-yellow-400 text-yellow-400 text-2xl hover:bg-yellow-400 hover:text-black transition-all transform hover:rotate-90 z-[9999] cursor-pointer"
              style={{ zIndex: 9999 }}
              title="Chiudi modalità immersiva"
            >
              ×
            </button>

            <div className="relative z-10 w-full h-full flex items-center justify-center">
              {immersiveVision.media ? (
                <div className="relative w-[70%] h-[70%] flex items-center justify-center">
                  {immersiveVision.mediaType === 'image' ? (
                    immersiveVision.media && immersiveVision.media.startsWith('data:') ? (
                      <img 
                        src={immersiveVision.media} 
                        alt={immersiveVision.title}
                        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                        style={{ objectFit: 'contain' }}
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-8xl shadow-2xl relative rounded-lg">
                        📷
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="text-white/80 text-2xl font-medium text-center">
                            Immagine: {immersiveVision.title}
                          </div>
                        </div>
                      </div>
                    )
                  ) : (
                    immersiveVision.media && (immersiveVision.media.startsWith('data:') || indexedDBVideoURL) ? (
                      <video 
                        src={immersiveVision.media.startsWith('INDEXEDDB:') ? indexedDBVideoURL : immersiveVision.media} 
                        controls
                        autoPlay
                        muted
                        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                        style={{ background: 'black', objectFit: 'contain' }}
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-red-500 to-pink-500 flex items-center justify-center text-8xl shadow-2xl relative overflow-hidden rounded-lg">
                        <div className="absolute inset-0 bg-black/20"></div>
                        <div className="relative z-10 flex flex-col items-center justify-center">
                          <div className="text-8xl mb-4">🎬</div>
                          <div className="text-white text-xl font-medium text-center max-w-md">
                            Video: {immersiveVision.title}
                          </div>
                          <div className="mt-4 px-6 py-2 bg-white/20 backdrop-blur-md rounded-full border border-white/30">
                            <span className="text-white text-sm">
                              {immersiveVision.media === 'placeholder' ? '⚠️ File troppo grande (>1MB)' : '▶ File caricato'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  )}
                </div>
              ) : (
                <div className="text-center">
                  <div className="text-8xl mb-8 text-yellow-400 animate-pulse">✧</div>
                  <h2 className="text-5xl font-bold text-yellow-400 mb-6">{immersiveVision.title}</h2>
                  <p className="text-2xl text-white max-w-4xl leading-relaxed italic">
                    {immersiveVision.description}
                  </p>
                </div>
              )}
            </div>

            {immersiveVision.audio && (
              <div className="absolute bottom-24 left-1/2 transform -translate-x-1/2 flex items-center gap-4 p-4 bg-black/70 backdrop-blur-md rounded-full border border-yellow-400/50 shadow-2xl">
                <div className="flex items-center gap-1">
                  {[...Array(5)].map((_, i) => (
                    <div 
                      key={i} 
                      className="w-1 bg-yellow-400 rounded-full animate-pulse shadow-sm" 
                      style={{ 
                        height: `${15 + Math.sin(Date.now() * 0.001 + i) * 10}px`, 
                        animationDelay: `${i * 0.15}s`,
                        animationDuration: '0.8s'
                      }}
                    ></div>
                  ))}
                </div>
                <span className="text-yellow-400 text-sm uppercase tracking-wider font-medium">
                  ♪ Audio in riproduzione
                </span>
              </div>
            )}

            <div className="absolute bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-black/95 via-black/70 to-transparent">
              <div className="max-w-4xl mx-auto text-center">
                <h2 className="text-4xl font-bold text-yellow-400 mb-4 drop-shadow-2xl">
                  {immersiveVision.title}
                </h2>
                {immersiveVision.description && (
                  <p className="text-xl text-white leading-relaxed italic opacity-90 drop-shadow-lg">
                    {immersiveVision.description}
                  </p>
                )}
                <div className="mt-4 h-1 w-32 bg-gradient-to-r from-transparent via-yellow-400 to-transparent mx-auto"></div>
              </div>
            </div>

            <audio ref={immersiveAudioRef} style={{ display: 'none' }} />
          </div>
        )}

        {/* Toast Notifications */}
        <div id="toast" className="toast">
          ✧ Visione Manifestata con Successo ✧
        </div>
        
        <div id="deleteToast" className="toast" style={{ background: 'linear-gradient(135deg, rgba(255, 69, 87, 0.2), rgba(255, 69, 87, 0.05))', borderColor: '#ff4757', color: '#ff4757' }}>
          🗑️ Visione Eliminata con Successo
        </div>
      </div>
    </>
  );
}