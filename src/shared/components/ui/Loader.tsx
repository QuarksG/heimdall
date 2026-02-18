import React from 'react';
import { Spinner } from 'react-bootstrap';

// Note: Once you have a Lottie JSON file (e.g., in assets/animations/loader.json),
// you can import Lottie from 'react-lottie-loader' and switch the return statement.

interface LoaderProps {
  message?: string;
  fullScreen?: boolean;
}

const Loader: React.FC<LoaderProps> = ({ message = 'Loading...', fullScreen = false }) => {
  const containerClass = fullScreen 
    ? "d-flex flex-column justify-content-center align-items-center vh-100 position-fixed top-0 start-0 w-100 bg-white"
    : "d-flex flex-column justify-content-center align-items-center p-5";

  const zIndex = fullScreen ? { zIndex: 1050 } : {};

  return (
    <div className={containerClass} style={zIndex}>
      <Spinner animation="border" role="status" variant="primary">
        <span className="visually-hidden">Loading...</span>
      </Spinner>
      <p className="mt-3 text-muted">{message}</p>
    </div>
  );
};

export default Loader;