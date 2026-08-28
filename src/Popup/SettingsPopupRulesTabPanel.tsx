import { Alert, Box, Button, Checkbox, FormControlLabel, List, ListItem, Stack, TextField, Typography } from '@mui/material';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCustomStyle } from '../Contexts/CustomStyleContext';
import { createBrowserAutofillRuleStore } from '../Content/Autofill/BrowserAutofillRuleStorage';
import type { StoredAutofillSiteRule } from '../Content/Autofill/AutofillRuleStore';

interface Props {
  index: number;
  value: number;
}

const ruleStore = createBrowserAutofillRuleStore();

function SettingsPopupRulesTabPanel({ value, index }: Props) {
  const [t] = useTranslation('global');
  const { sizeHandler } = useCustomStyle();
  const [json, setJson] = useState('');
  const [rules, setRules] = useState<StoredAutofillSiteRule[]>([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const refresh = useCallback(async () => {
    const exported = await ruleStore.export();
    const parsed = JSON.parse(exported) as { rules: StoredAutofillSiteRule[] };
    setJson(exported);
    setRules(parsed.rules);
  }, []);

  useEffect(() => {
    void refresh().catch(errorValue => setError(String(errorValue)));
  }, [refresh]);

  const importRules = async () => {
    try {
      await ruleStore.import(json);
      setError('');
      setSaved(true);
      await refresh();
    } catch (errorValue) {
      setSaved(false);
      setError(errorValue instanceof Error ? errorValue.message : String(errorValue));
    }
  };

  const runRuleOperation = async (operation: () => Promise<void>) => {
    try {
      await operation();
      setError('');
      setSaved(false);
    } catch (errorValue) {
      setSaved(false);
      setError(errorValue instanceof Error ? errorValue.message : String(errorValue));
    }
  };

  const toggleRule = async (rule: StoredAutofillSiteRule) => {
    await runRuleOperation(async () => {
      await ruleStore.setEnabled(rule.id, rule.enabled === false);
      await refresh();
    });
  };

  const removeRule = async (id: string) => {
    await runRuleOperation(async () => {
      await ruleStore.remove(id);
      await refresh();
    });
  };

  return (
    <div role="tabpanel" hidden={value !== index} id={`vertical-tabpanel-${index}`} aria-labelledby={`vertical-tab-${index}`}>
      {value === index ? (
        <Box
          sx={{
            height: '350px',
            overflowY: 'auto',
            overflowWrap: 'anywhere',
            p: 1
          }}
        >
          <Stack spacing={1} sx={{ width: sizeHandler.getSettingsPopupTabPanelsWidth() }}>
            <Typography variant="body2">{t('settings-popup-component.rules-description')}</Typography>
            {error ? <Alert severity="error">{error}</Alert> : null}
            {saved ? <Alert severity="success">{t('settings-popup-component.rules-saved')}</Alert> : null}
            <TextField
              aria-label={t('settings-popup-component.rules-json')}
              multiline
              minRows={7}
              maxRows={12}
              value={json}
              onChange={event => {
                setJson(event.target.value);
                setSaved(false);
              }}
              size="small"
            />
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={importRules}>
                {t('settings-popup-component.rules-import')}
              </Button>
              <Button variant="outlined" onClick={() => void runRuleOperation(refresh)}>
                {t('settings-popup-component.rules-export')}
              </Button>
            </Stack>
            <List dense disablePadding>
              {rules.map(rule => (
                <ListItem
                  key={rule.id}
                  disableGutters
                  secondaryAction={
                    <Button color="error" size="small" onClick={() => void removeRule(rule.id)}>
                      {t('settings-popup-component.rules-delete')}
                    </Button>
                  }
                >
                  <FormControlLabel control={<Checkbox checked={rule.enabled !== false} onChange={() => void toggleRule(rule)} />} label={rule.id} />
                </ListItem>
              ))}
            </List>
          </Stack>
        </Box>
      ) : null}
    </div>
  );
}

export default SettingsPopupRulesTabPanel;
