'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';

export default function TestModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const modal = (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 99999
      }}
      onClick={() => setIsOpen(false)}
    >
      <div 
        style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          width: '400px',
          maxWidth: '90vw'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{color: 'black', marginBottom: '20px'}}>TEST MODAL</h2>
        
        <div style={{marginBottom: '20px', padding: '10px', backgroundColor: '#f0f0f0', color: 'black'}}>
          DEBUG: Title="{title}", Description="{description}"
        </div>

        <div style={{marginBottom: '15px'}}>
          <label style={{display: 'block', color: 'black', marginBottom: '5px'}}>Title:</label>
          <input 
            type="text"
            value={title}
            onChange={(e) => {
              console.log('Title changed to:', e.target.value);
              setTitle(e.target.value);
            }}
            style={{
              width: '100%',
              padding: '8px',
              border: '2px solid #ccc',
              borderRadius: '4px',
              color: 'black !important',
              backgroundColor: 'white !important',
              fontSize: '16px'
            }}
            placeholder="Enter title here"
            autoFocus
          />
        </div>

        <div style={{marginBottom: '15px'}}>
          <label style={{display: 'block', color: 'black', marginBottom: '5px'}}>Description:</label>
          <textarea 
            value={description}
            onChange={(e) => {
              console.log('Description changed to:', e.target.value);
              setDescription(e.target.value);
            }}
            style={{
              width: '100%',
              padding: '8px',
              border: '2px solid #ccc',
              borderRadius: '4px',
              color: 'black !important',
              backgroundColor: 'white !important',
              fontSize: '16px',
              minHeight: '60px',
              resize: 'vertical'
            }}
            placeholder="Enter description here"
          />
        </div>

        <div>
          <button 
            onClick={() => setIsOpen(false)}
            style={{
              padding: '8px 16px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              marginRight: '10px'
            }}
          >
            Close
          </button>
          <button 
            onClick={() => {
              alert(`Title: ${title}, Description: ${description}`);
              setIsOpen(false);
            }}
            style={{
              padding: '8px 16px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Test Values
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <button 
        onClick={() => setIsOpen(true)}
        style={{
          padding: '10px 20px',
          backgroundColor: '#dc3545',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '16px',
          margin: '10px'
        }}
      >
        🚨 OPEN TEST MODAL 🚨
      </button>
      
      {isOpen && typeof window !== 'undefined' && createPortal(modal, document.body)}
    </div>
  );
}