import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

const MainLayout: React.FC = () => {
  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <main 
        id="content"
        style={{
          flex: 1,
          marginLeft: '256px',
          backgroundColor: '#ffffff',
          height: '100%',
          overflowY: 'auto',
          overflowX: 'hidden',
          position: 'relative'
        }}
      >
        <Outlet />
      </main>
    </div>
  );
};

export default MainLayout;