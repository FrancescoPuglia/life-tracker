"use client";

import { useState, useEffect, useRef } from 'react';
import { useAuthContext } from '@/providers/AuthProvider';
import { db } from '@/lib/database';

// ============================================================================
// TYPES
// ============================================================================

interface Vision {
  id: number;
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
// VISION BOARD STANDALONE COMPONENT
// ============================================================================

interface VisionBoardStandaloneProps {
  className?: string;
}

export default function VisionBoardStandalone({ className = "" }: VisionBoardStandaloneProps) {
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
  const [editingField, setEditingField] = useState<'title' | 'subtitle' | null>(null);
  const [currentQuote, setCurrentQuote] = useState<Quote>({ text: '', author: '' });
  
  // Form state
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'successo' as Vision['category']
  });
  
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string>('');
  const [audioPreview, setAudioPreview] = useState<string>('');
  
  const starsRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<HTMLDivElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = Math.min((scrollTop / docHeight) * 100, 100);
      
      // Update scroll progress if needed
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isModalOpen) {
        setIsModalOpen(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    window.addEventListener('keydown', handleEscape);
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isModalOpen]);

  // ========== DATA MANAGEMENT ==========

  const loadVisions = async () => {
    try {
      if (!user) return;
      // TODO: Load from Firebase Firestore
      const savedVisions = localStorage.getItem(`visions_${user.uid}`);
      if (savedVisions) {
        setVisions(JSON.parse(savedVisions));
      }
    } catch (error) {
      console.error('Failed to load visions:', error);
    }
  };

  const saveVisions = async (newVisions: Vision[]) => {
    try {
      if (!user) return;
      setVisions(newVisions);
      // TODO: Save to Firebase Firestore
      localStorage.setItem(`visions_${user.uid}`, JSON.stringify(newVisions));
    } catch (error) {
      console.error('Failed to save visions:', error);
    }
  };

  const loadBoardSettings = async () => {
    try {
      if (!user) return;
      // TODO: Load from Firebase Firestore
      const saved = localStorage.getItem(`boardSettings_${user.uid}`);
      if (saved) {
        setBoardSettings(JSON.parse(saved));
      }
    } catch (error) {
      console.error('Failed to load board settings:', error);
    }
  };

  const saveBoardSettings = async (settings: BoardSettings) => {
    try {
      if (!user) return;
      setBoardSettings(settings);
      // TODO: Save to Firebase Firestore
      localStorage.setItem(`boardSettings_${user.uid}`, JSON.stringify(settings));
    } catch (error) {
      console.error('Failed to save board settings:', error);
    }
  };

  // ========== UI FUNCTIONS ==========

  const setRandomQuote = () => {
    const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
    setCurrentQuote(randomQuote);
  };

  const createStars = () => {
    if (!starsRef.current) return;
    
    starsRef.current.innerHTML = '';
    for (let i = 0; i < 150; i++) {
      const star = document.createElement('div');
      star.className = 'absolute w-1 h-1 bg-yellow-200 rounded-full animate-pulse';
      star.style.left = Math.random() * 100 + '%';
      star.style.top = Math.random() * 100 + '%';
      star.style.animationDelay = Math.random() * 5 + 's';
      star.style.animationDuration = (Math.random() * 3 + 2) + 's';
      starsRef.current.appendChild(star);
    }
  };

  const createParticles = () => {
    if (!particlesRef.current) return;
    
    particlesRef.current.innerHTML = '';
    for (let i = 0; i < 20; i++) {
      const particle = document.createElement('div');
      particle.className = 'absolute w-1 h-1 bg-yellow-400 rounded-full opacity-60';
      particle.style.left = Math.random() * 100 + '%';
      particle.style.animationDelay = Math.random() * 8 + 's';
      particle.style.animationDuration = (Math.random() * 4 + 6) + 's';
      particlesRef.current.appendChild(particle);
    }
  };

  // ========== FILE HANDLING ==========

  const handleFileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleMediaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log('🔍 SHERLOCK: Media file selected!');
    const file = e.target.files?.[0];
    if (!file) return;

    setMediaFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setMediaPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleAudioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAudioFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setAudioPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  // ========== VISION MANAGEMENT ==========

  const handleAddVision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      const vision: Vision = {
        id: Date.now(),
        title: formData.title,
        description: formData.description,
        category: formData.category,
        date: new Date().toISOString(),
        userId: user.uid,
        domainId: 'default'
      };

      if (mediaFile) {
        vision.media = await handleFileToBase64(mediaFile);
        vision.mediaType = mediaFile.type.startsWith('image/') ? 'image' : 'video';
      }

      if (audioFile) {
        vision.audio = await handleFileToBase64(audioFile);
      }

      const newVisions = [vision, ...visions];
      await saveVisions(newVisions);
      
      // Reset form
      setFormData({ title: '', description: '', category: 'successo' });
      setMediaFile(null);
      setAudioFile(null);
      setMediaPreview('');
      setAudioPreview('');
      setIsModalOpen(false);
      
      // Show success toast (TODO: implement)
      
    } catch (error) {
      console.error('Failed to add vision:', error);
    }
  };

  const handleDeleteVision = async (id: number) => {
    if (!confirm('Sei sicuro di voler eliminare questa visione?')) return;
    
    const newVisions = visions.filter(v => v.id !== id);
    await saveVisions(newVisions);
  };

  // ========== COUNTERS ==========

  const getTotalMedia = () => visions.filter(v => v.media || v.audio).length;
  
  const getManifestDays = () => {
    const startDate = new Date(boardSettings.startDate);
    const today = new Date();
    return Math.max(1, Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('it-IT', { 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    });
  };

  // ========== RENDER ==========

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-center">
        <div className="text-gray-600 dark:text-gray-400">
          Please sign in to access your Vision Board
        </div>
      </div>
    );
  }

  return (
    <div className={`relative min-h-screen bg-gray-900 text-yellow-100 ${className}`}>
      {/* Cosmic Background */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-gray-900 to-blue-900/20" />
        <div ref={starsRef} className="absolute inset-0 overflow-hidden" />
        <div ref={particlesRef} className="absolute inset-0 overflow-hidden" />
      </div>

      {/* Content */}
      <div className="relative z-10">
        {/* Header */}
        <header className="text-center py-16 px-8 relative overflow-hidden">
          <div className="relative z-10">
            <h1 
              className="text-6xl md:text-8xl font-bold bg-gradient-to-r from-yellow-200 via-yellow-400 to-yellow-600 bg-clip-text text-transparent mb-4 cursor-pointer hover:scale-105 transition-transform"
              onClick={() => setEditingField('title')}
            >
              {boardSettings.title}
            </h1>
            <p 
              className="text-xl md:text-2xl text-yellow-200/70 italic cursor-pointer hover:text-yellow-200 transition-colors"
              onClick={() => setEditingField('subtitle')}
            >
              {boardSettings.subtitle}
            </p>
            
            <div className="flex items-center justify-center my-8">
              <div className="h-px bg-gradient-to-r from-transparent via-yellow-400 to-transparent flex-1 max-w-32" />
              <div className="w-3 h-3 bg-yellow-400 transform rotate-45 mx-4 shadow-lg shadow-yellow-400/50" />
              <div className="h-px bg-gradient-to-r from-transparent via-yellow-400 to-transparent flex-1 max-w-32" />
            </div>

            {/* Counters */}
            <div className="flex justify-center gap-8 md:gap-16 mt-12 flex-wrap">
              <div className="text-center p-6 bg-white/5 border border-yellow-400/20 rounded-xl backdrop-blur-sm hover:bg-white/10 transition-all">
                <div className="text-4xl font-bold text-yellow-400 mb-2">{visions.length}</div>
                <div className="text-sm text-yellow-200/60 uppercase tracking-wider">Visioni Create</div>
              </div>
              <div className="text-center p-6 bg-white/5 border border-yellow-400/20 rounded-xl backdrop-blur-sm hover:bg-white/10 transition-all">
                <div className="text-4xl font-bold text-yellow-400 mb-2">{getTotalMedia()}</div>
                <div className="text-sm text-yellow-200/60 uppercase tracking-wider">Media Caricati</div>
              </div>
              <div className="text-center p-6 bg-white/5 border border-yellow-400/20 rounded-xl backdrop-blur-sm hover:bg-white/10 transition-all">
                <div className="text-4xl font-bold text-yellow-400 mb-2">{getManifestDays()}</div>
                <div className="text-sm text-yellow-200/60 uppercase tracking-wider">Giorni di Pratica</div>
              </div>
            </div>
          </div>
        </header>

        {/* Daily Quote */}
        <div className="max-w-4xl mx-auto px-8 mb-12">
          <div className="relative p-8 bg-white/5 border border-yellow-400/20 rounded-2xl backdrop-blur-sm text-center">
            <div className="absolute top-4 left-6 text-6xl text-yellow-400/30 font-serif">"</div>
            <div className="absolute bottom-0 right-6 text-6xl text-yellow-400/30 font-serif">"</div>
            <p className="text-xl md:text-2xl italic text-yellow-100 leading-relaxed mb-4 px-8">
              {currentQuote.text}
            </p>
            <p className="text-sm text-yellow-200/60 tracking-widest font-mono">
              — {currentQuote.author}
            </p>
          </div>
        </div>

        {/* Vision Grid */}
        <main className="max-w-7xl mx-auto px-8 pb-32">
          {visions.length === 0 ? (
            <div className="text-center py-24">
              <div className="text-8xl mb-8 opacity-30">✧</div>
              <h2 className="text-3xl font-bold text-yellow-400 mb-4">Inizia a Manifestare</h2>
              <p className="text-xl text-yellow-200/70 max-w-lg mx-auto">
                Clicca il pulsante ✦ per aggiungere la tua prima visione. 
                Carica foto, video o audio dei tuoi sogni e obiettivi.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {visions.map((vision, index) => (
                <div 
                  key={vision.id} 
                  className="group bg-white/5 border border-yellow-400/20 rounded-2xl overflow-hidden backdrop-blur-sm hover:bg-white/10 hover:border-yellow-400/40 transition-all duration-300 hover:-translate-y-2"
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  {/* Delete Button */}
                  <div className="absolute top-4 left-4 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleDeleteVision(vision.id)}
                      className="w-8 h-8 bg-red-500/80 hover:bg-red-500 rounded-full flex items-center justify-center text-white transition-colors"
                    >
                      ×
                    </button>
                  </div>

                  {/* Media */}
                  {vision.media && (
                    <div className="relative h-64 overflow-hidden">
                      {vision.mediaType === 'image' ? (
                        <img 
                          src={vision.media} 
                          alt={vision.title}
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                        />
                      ) : (
                        <video 
                          src={vision.media}
                          controls
                          className="w-full h-full object-cover"
                        />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-gray-900/60 to-transparent" />
                      <div className="absolute top-4 right-4 px-3 py-1 bg-black/70 rounded-full text-xs text-yellow-400 border border-yellow-400/30">
                        {vision.mediaType === 'image' ? '📷 Foto' : '🎬 Video'}
                      </div>
                    </div>
                  )}

                  {/* Content */}
                  <div className="p-6">
                    <h3 className="text-xl font-bold text-yellow-400 mb-3 leading-tight">
                      {vision.title}
                    </h3>
                    
                    {vision.description && (
                      <p className="text-yellow-100/80 leading-relaxed mb-4">
                        {vision.description}
                      </p>
                    )}

                    {vision.audio && (
                      <div className="my-4">
                        <audio 
                          src={vision.audio}
                          controls
                          className="w-full h-10 rounded-lg"
                        />
                      </div>
                    )}

                    <div className="text-xs text-yellow-200/40 font-mono tracking-wider uppercase">
                      {formatDate(vision.date)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Add Vision Button */}
      <button
        onClick={() => setIsModalOpen(true)}
        className="fixed bottom-8 right-8 w-16 h-16 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-full shadow-2xl shadow-yellow-400/50 text-gray-900 text-2xl font-bold hover:scale-110 active:scale-95 transition-all duration-200 z-50 flex items-center justify-center"
      >
        ✦
      </button>

      {/* Modal */}
      {isModalOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsModalOpen(false);
            }
          }}
        >
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-gray-900/95 border border-yellow-400/30 rounded-3xl p-8 backdrop-blur-lg">
            <button
              onClick={(e) => {
                console.log('🔍 SHERLOCK: Close button clicked!');
                e.preventDefault();
                e.stopPropagation();
                setIsModalOpen(false);
              }}
              className="absolute top-6 right-6 w-10 h-10 bg-transparent border border-yellow-400/30 rounded-full text-yellow-400 hover:bg-yellow-400/10 transition-colors flex items-center justify-center z-50 text-xl font-bold"
            >
              ×
            </button>

            <h2 className="text-3xl font-bold text-yellow-400 text-center mb-8">
              ✧ Nuova Visione ✧
            </h2>

            <form onSubmit={handleAddVision} className="space-y-6">
              {/* Title */}
              <div>
                <label className="block text-sm font-bold text-yellow-400 mb-3 uppercase tracking-widest">
                  Titolo della Visione
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Es: Il mio successo nel 2025"
                  className="w-full px-6 py-4 bg-white/5 border border-yellow-400/20 rounded-xl text-yellow-100 placeholder-yellow-200/40 focus:border-yellow-400 focus:bg-white/10 transition-all"
                  required
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-bold text-yellow-400 mb-3 uppercase tracking-widest">
                  Descrizione / Affermazione
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Descrivi la tua visione in dettaglio. Usa il presente come se fosse già realtà..."
                  rows={4}
                  className="w-full px-6 py-4 bg-white/5 border border-yellow-400/20 rounded-xl text-yellow-100 placeholder-yellow-200/40 focus:border-yellow-400 focus:bg-white/10 transition-all resize-none"
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-bold text-yellow-400 mb-3 uppercase tracking-widest">
                  Categoria
                </label>
                <div className="flex flex-wrap gap-3">
                  {[
                    { key: 'successo', label: '✦ Successo' },
                    { key: 'salute', label: '♡ Salute' },
                    { key: 'relazioni', label: '❋ Relazioni' },
                    { key: 'ricchezza', label: '◈ Ricchezza' },
                    { key: 'crescita', label: '⬡ Crescita' }
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, category: key as Vision['category'] }))}
                      className={`px-4 py-2 rounded-full border transition-all ${
                        formData.category === key
                          ? 'border-yellow-400 bg-yellow-400/20 text-yellow-400'
                          : 'border-yellow-400/20 text-yellow-200/70 hover:border-yellow-400/40'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Media Upload */}
              <div>
                <label className="block text-sm font-bold text-yellow-400 mb-3 uppercase tracking-widest">
                  Immagine o Video
                </label>
                <div 
                  onClick={() => {
                    console.log('🔍 SHERLOCK: Media upload area clicked!');
                    mediaInputRef.current?.click();
                  }}
                  className="border-2 border-dashed border-yellow-400/30 rounded-xl p-8 text-center hover:border-yellow-400/50 transition-colors cursor-pointer"
                >
                  <div className="text-4xl mb-4">◇</div>
                  <div className="text-yellow-100 mb-2">Trascina qui o clicca per caricare</div>
                  <div className="text-yellow-200/40 text-sm mb-4">JPG, PNG, GIF, MP4, WebM</div>
                </div>
                <input
                  ref={mediaInputRef}
                  type="file"
                  onChange={handleMediaChange}
                  accept="image/*,video/*"
                  className="hidden"
                />
                
                {mediaPreview && (
                  <div className="mt-4 p-4 bg-green-900/20 border border-green-400/30 rounded-xl">
                    {mediaFile?.type.startsWith('image/') ? (
                      <img src={mediaPreview} alt="Preview" className="max-w-full max-h-48 rounded-lg mx-auto" />
                    ) : (
                      <video src={mediaPreview} controls className="max-w-full max-h-48 rounded-lg mx-auto" />
                    )}
                  </div>
                )}
              </div>

              {/* Audio Upload */}
              <div>
                <label className="block text-sm font-bold text-yellow-400 mb-3 uppercase tracking-widest">
                  Audio (Affermazione / Musica)
                </label>
                <div 
                  onClick={() => {
                    console.log('🔍 SHERLOCK: Audio upload area clicked!');
                    audioInputRef.current?.click();
                  }}
                  className="border-2 border-dashed border-yellow-400/30 rounded-xl p-8 text-center hover:border-yellow-400/50 transition-colors cursor-pointer"
                >
                  <div className="text-4xl mb-4">♪</div>
                  <div className="text-yellow-100 mb-2">Carica un file audio</div>
                  <div className="text-yellow-200/40 text-sm mb-4">MP3, WAV, OGG</div>
                </div>
                <input
                  ref={audioInputRef}
                  type="file"
                  onChange={handleAudioChange}
                  accept="audio/*"
                  className="hidden"
                />
                
                {audioPreview && (
                  <div className="mt-4 p-4 bg-green-900/20 border border-green-400/30 rounded-xl">
                    <audio src={audioPreview} controls className="w-full" />
                  </div>
                )}
              </div>

              {/* Submit */}
              <button
                type="submit"
                className="w-full py-4 bg-gradient-to-r from-yellow-500 to-yellow-600 text-gray-900 font-bold text-lg rounded-xl hover:from-yellow-400 hover:to-yellow-500 transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-yellow-400/30"
              >
                ✧ Manifesta Questa Visione ✧
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}