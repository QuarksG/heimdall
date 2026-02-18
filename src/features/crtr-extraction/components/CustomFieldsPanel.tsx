import React from 'react';
import type { CustomFieldsPanelProps, CustomFieldConfig } from '../types/crtr.types';
import { CUSTOM_FIELD_DEFS, TAX_SCHEME_OPTIONS, DESCRIPTION_FIELD_OPTIONS } from '../constants/crtrDefaults';



export const CustomFieldsPanel = ({
  show,
  config,
  descriptionField,
  onConfigChange,
  onDescriptionFieldChange,
  onApply,
  onCancel,
  uniqueTaxCodes,
}: CustomFieldsPanelProps): React.ReactElement | null => {
  if (!show) return null;

  const handleItemFieldChange = (field: keyof CustomFieldConfig['Item'], value: string): void => {
    onConfigChange((prevConfig) => ({
      ...prevConfig,
      Item: { ...prevConfig.Item, [field]: value },
    }));
  };

  const handleTaxFieldChange = (field: 'taxSchemeOverride', value: string): void => {
    onConfigChange((prevConfig) => ({
      ...prevConfig,
      Tax: { ...prevConfig.Tax, [field]: value },
    }));
  };

  const handleTaxGlAccountChange = (key: string, value: string): void => {
    onConfigChange((prevConfig) => ({
      ...prevConfig,
      Tax: {
        ...prevConfig.Tax,
        glAccount: { ...prevConfig.Tax.glAccount, [key]: value },
      },
    }));
  };

  const itemFields = config.Item;
  const taxGlAccounts = config.Tax.glAccount;

  return (
    <div className="cfg-ovl">
      <div className="cfg-pnl">
        <h2 className="cfg-h2">Manual Entry Fields</h2>

        <div className="cfg-sec">
          <h3 className="cfg-sec-h">Description Field Source</h3>
          <div className="cfg-grid">
            <div>
              <label className="lbl">Select Description Field</label>
              <select
                value={descriptionField}
                onChange={(e) => onDescriptionFieldChange(e.target.value as typeof descriptionField)}
                className="txt-in"
              >
                {DESCRIPTION_FIELD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="cfg-sec item">
          <h3 className="cfg-sec-h item">General Invoice & Item Line Details</h3>
          <div className="cfg-grid">
            {Object.entries(CUSTOM_FIELD_DEFS).map(([key, def]) => {
              const itemKey = key as keyof CustomFieldConfig['Item'];
              return (
                <div key={key}>
                  <label className="lbl">{def.label}</label>
                  {def.type === 'select' ? (
                    <select
                      value={itemFields[itemKey]}
                      onChange={(e) => handleItemFieldChange(itemKey, e.target.value)}
                      className="txt-in"
                    >
                      {(def.options ?? []).map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={itemFields[itemKey]}
                      onChange={(e) => handleItemFieldChange(itemKey, e.target.value)}
                      className="txt-in"
                    />
                  )}
                </div>
              );
            })}
            <div>
              <label className="lbl">Item Line GL Account</label>
              <input
                type="text"
                value={itemFields.glAccount}
                onChange={(e) => handleItemFieldChange('glAccount', e.target.value)}
                className="txt-in"
              />
            </div>
          </div>
        </div>

        <div className="cfg-sec tax">
          <h3 className="cfg-sec-h tax">Tax Line Details</h3>
          <div className="cfg-grid">
            <div>
              <label className="lbl">Tax Scheme Override</label>
              <select
                value={config.Tax.taxSchemeOverride || ''}
                onChange={(e) => handleTaxFieldChange('taxSchemeOverride', e.target.value)}
                className="txt-in"
              >
                {TAX_SCHEME_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="lbl">Default Tax Line GL Account</label>
              <input
                type="text"
                value={taxGlAccounts.default ?? ''}
                onChange={(e) => handleTaxGlAccountChange('default', e.target.value)}
                className="txt-in"
              />
            </div>
          </div>

          {uniqueTaxCodes.length > 0 && (
            <>
              <h4 className="cfg-h4">Tax Regime Specific GL Accounts (Overrides)</h4>
              <div className="cfg-grid">
                {uniqueTaxCodes.map((code) => (
                  <div key={code}>
                    <label className="lbl">{code}</label>
                    <input
                      type="text"
                      value={taxGlAccounts[code] || ''}
                      onChange={(e) => handleTaxGlAccountChange(code, e.target.value)}
                      className="txt-in"
                      placeholder="Using default"
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="cfg-foot">
          <button onClick={onCancel} className="btn btn-sec">
            Cancel
          </button>
          <button onClick={onApply} className="btn btn-prim">
            Apply CFG
          </button>
        </div>
      </div>
    </div>
  );
};