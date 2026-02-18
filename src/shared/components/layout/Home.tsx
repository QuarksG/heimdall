// src/shared/components/layout/Home.tsx
import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../features/authentication/context/AuthContext";
import "../../../styles/Home.css";

const FEATURES = [
  {
    id: "invoice-parsing",
    title: "Invoice Parsing",
    icon: "ph-file-text",
    route: "/invoice-parsing",
    description:
      "Bulk-parse Turkish e-fatura XML and ZIP files. Extract 35+ header and line-item fields",
    howTo: [
      "Upload one or more .xml or .zip files containing e-fatura XML format invoices.",
      "Select the columns you need from the sidebar header selector (toggle line-item fields for per-line detail).",
      "Use the search bar to filter records on live.",
      "Click Download as Excel to export the data to .xlsx.",
    ],
    expects: "Turkish UBL 2.1 e-fatura XML files (or ZIP archives containing them).",
    outputs: "On-screen data table + downloadable Excel report.",
  },
  {
    id: "invoice-validation-retail",
    title: "Retail Invoice Validator",
    icon: "ph-calendar-blank",
    route: "/invoice-validation/retail",
    description:
      "Chat-style validation engine for Retail AP invoices. Upload an XML of AP retail invoice to check compliance results.",
    howTo: [
      "Upload a single XML invoice (or a ZIP with one invoice).",
      "The validator automatically extracts required fields and runs standard AP FinOps checks.",
      "Review the chat-style results for each field and check status.",
      "Only invoices with all fields passing validation are considered  however because of updates and changes better to always issue first test invoice.",
    ],
    expects: "Single e-fatura XML file for Retail",
    outputs: " Validation report with pass/fail status per field.",
  },
  {
    id: "invoice-conversion",
    title: "Invoice Convert",
    icon: "ph-chart-bar",
    route: "/invoice-conversion",
    description:
      "Decode, preview, and convert e-fatura invoices to view PDF format.",
    howTo: [
      "Drag & drop or browse to upload XML/ZIP files.",
      "The tool converts the XML to a PDF viewable in browser.",
    ],
    expects: "UBL 2.1 XML invoices individually or in ZIP archives.",
    outputs: "Visual invoice preview, print-ready view, Excel export.",
  },
  {
    id: "invoice-validation-df",
    title: "DF Invoice Validator",
    icon: "ph-chart-bar",
    route: "/invoice-validation/dropship",
    description:
      "Validation engine built for Amazon Drop-Ship (Fulfilled by Partner) invoices. Checks dropship fields however the up to date standards subject to change. Please inform us accordingly",
    howTo: [
      "Upload a drop-ship XML invoice (or ZIP).",
      "The validator runs DF-specific checks",
      "Review the validation results for each field.",
    ],
    expects: "Drop-ship e-fatura XML ",
    outputs: "DF-specific validation report with pass/fail per check.",
  },
  {
    id: "payment-reconciliation",
    title: "E-Reconciliation",
    icon: "ph-chart-bar",
    route: "/payment-reconciliation",
    description:
      "Reconcile payment remittance files(OFA).",
    howTo: [
      "Upload the Amazon payment remittance .xlsx file.",
      "Download the parsed data as an Excel file for validation.",
    ],
    expects: "Payment remittance text file (tab-delimited format).",
    outputs: "Filterable payment table + Excel download.",
  },
  {
    id: "crtr-extraction",
    title: "CRTR Extraction",
    icon: "ph-file-export",
    route: "/crtr-extraction",
    description:
      "Extract e-invoice data to prepare CRTR reports.",
    howTo: [
      "Upload a ZIP archive containing multiple e-fatura XML files.",
      "Fill the missing fields",
      "Review the output table and make any necessary corrections.",
      "Download the CRTR report as Excel for submission",
    ],
    expects: "ZIP archive of UBL 2.1 e-fatura XML invoices.",
    outputs: "CRTR summary table + Excel export.",
  },
];

const RESOURCES = [
  {
    title: "GIB Official Website",
    url: "https://www.gib.gov.tr/",
    description: "Turkish Revenue Administration — official e-fatura regulations and announcements.",
  },
  {
    title: "GIB e-Fatura XML Format",
    url: "https://ebelge.gib.gov.tr/dosyalar/kilavuzlar/e-FaturaPaketi.zip",
    description: "Download the official e-fatura package with XML schema, sample files, and field definitions.",
  },
  {
    title: "UBL 2.0 Invoice Example",
    url: "https://docs.oasis-open.org/ubl/os-UBL-2.0/xml/UBL-Invoice-2.0-Example.xml",
    description: "OASIS standard UBL 2.0 invoice XML example — reference for understanding invoice structure.",
  },
];

const Home: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div className="home">
      {/* ── Welcome ── */}
      <section className="home-hero">
        <h1 className="home-title">
          Welcome{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
        </h1>
        <p className="home-subtitle">
          <strong>Heimdall</strong> is internal toolkit for Turkish e-fatura processing — parse, validate, convert,
          reconcile, and extract invoice data across marketplaces.
        </p>
      </section>

      {/* ── Quick start ── */}
      <section className="home-section">
        <h2 className="home-section-title">Quick Start</h2>
        <div className="home-steps">
          <div className="home-step">
            <span className="home-step-num">1</span>
            <div>
              <strong>Request Access</strong>
              <p>Go to Access Request, select your country and the features you need, and submit.</p>
            </div>
          </div>
          <div className="home-step">
            <span className="home-step-num">2</span>
            <div>
              <strong>Get Approved</strong>
              <p>An admin reviews your request — once approved, the locked features unlock automatically but you need to sign out and then sign back in.</p>
            </div>
          </div>
          <div className="home-step">
            <span className="home-step-num">3</span>
            <div>
              <strong>Start Processing</strong>
              <p>Once approved, you can use unlocked feature by uploading your XML or ZIP files.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Feature Cards ── */}
      <section className="home-section">
        <h2 className="home-section-title">Features</h2>
        <div className="home-features">
          {FEATURES.map((f) => (
            <div
              key={f.id}
              className="home-feature-card"
              onClick={() => navigate(f.route)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && navigate(f.route)}
            >
              <div className="home-feature-header">
                <i className={`ph-bold ${f.icon} home-feature-icon`}></i>
                <h3 className="home-feature-title">{f.title}</h3>
              </div>

              <p className="home-feature-desc">{f.description}</p>

              <div className="home-feature-details">
                <div className="home-feature-detail">
                  <span className="home-detail-label">Input</span>
                  <span className="home-detail-value">{f.expects}</span>
                </div>
                <div className="home-feature-detail">
                  <span className="home-detail-label">Output</span>
                  <span className="home-detail-value">{f.outputs}</span>
                </div>
              </div>

              <div className="home-feature-how">
                <span className="home-detail-label">How to use</span>
                <ol className="home-how-list">
                  {f.howTo.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Resources ── */}
      <section className="home-section">
        <h2 className="home-section-title">Resources & References</h2>
        <div className="home-resources">
          {RESOURCES.map((r, i) => (
            <a
              key={i}
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="home-resource-card"
            >
              <i className="ph-bold ph-arrow-square-out home-resource-icon"></i>
              <div>
                <strong>{r.title}</strong>
                <p>{r.description}</p>
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* ── Disclosure ── */}
      <section className="home-section home-disclosure">
        <h2 className="home-section-title">Privacy & Security</h2>
        <p>
          Please do not share this tool with external users or share your account with other 3rd parties, as it has not yet been validated for such use cases. We recommend using only officially referenced data sources. 
          To ensure a smooth experience, do not upload anomalous files to the input fields. It can harm Amazon AWS cloud infrastructure.
        </p>
      </section>
    </div>
  );
};

export default Home;