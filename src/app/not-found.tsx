export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-400 mb-4">404</h1>
        <p className="text-xl text-gray-300 mb-8">Page not found</p>
        <a 
          href="/" 
          className="px-6 py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors"
        >
          Go Home
        </a>
      </div>
    </div>
  );
}