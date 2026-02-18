import React from 'react';
import '../../../styles/Home.css';



const Home: React.FC = () => {
  return (
    <div className="home">
      <div className="welcome">
        <h1>Project Heimdall</h1>
        <p>Your one-stop solution for managing invoices efficiently and effectively.</p>
      </div>

      <div className="info-boxes">
        <div className="info-box">
          <h2>Invoicing Process</h2>
          <p>Follow these steps to ensure your invoices are processed correctly:</p>
          <ul>
            <li>Prepare your invoice in the correct format.</li>
            <li>Ensure all mandatory fields are filled out.</li>
            <li>Submit the invoice to the appropriate platform.</li>
          </ul>
          <p>
            For more detailed information, visit the{' '}
            <a href="https://www.gib.gov.tr/" target="_blank" rel="noopener noreferrer">
              GIB website
            </a>
            .
          </p>
          <p>
            For more detailed information for the e-fatura XML format of GIB requirements, visit the{' '}
            <a
              href="https://ebelge.gib.gov.tr/dosyalar/kilavuzlar/e-FaturaPaketi.zip"
              target="_blank"
              rel="noopener noreferrer"
            >
              GIB fatura formati
            </a>
            .
          </p>
        </div>

        <div className="info-box">
          <h2>Sidebar App Manual</h2>
          <p>Our E Fatura app helps you manage invoices more effectively. Here’s how to use it:</p>
          <ul>
            <li>Register the E Fatura app from our website.</li>
            <li>Open the app and navigate to the invoices section.</li>
            <li>Follow the on-screen instructions to process your invoices.</li>
          </ul>
          <p>For a detailed manual, refer to the documentation included in the app.</p>
        </div>

        <div className="info-box">
          <h2>XML and UBL Information</h2>
          <p>Understand the structure and format of XML and UBL invoices:</p>
          <ul>
            <li>
              XML (eXtensible Markup Language) is a markup language that defines a set of rules for encoding documents.
            </li>
            <li>
              UBL (Universal Business Language) is a library of standard electronic XML business documents.
            </li>
          </ul>
          <p>
            For more detailed information for XML format of an invoice, visit the{' '}
            <a
              href="https://docs.oasis-open.org/ubl/os-UBL-2.0/xml/UBL-Invoice-2.0-Example.xml"
              target="_blank"
              rel="noopener noreferrer"
            >
              Example XML format
            </a>
            .
          </p>
          <p>Our application supports both XML and UBL formats for efficient invoicing.</p>
        </div>

        <div className="info-box">
          <h2>Disclosure</h2>
          <p>All information processed through this app is handled securely and in compliance with relevant regulations:</p>
          <ul>
            <li>Data privacy is our top priority.</li>
            <li>Your information is neither stored nor collected. The current model operates in input-output mode and does not retain any input data.</li>
            <li>The SPA application runs directly in your browser and does not rely on backend servers.</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default Home;
