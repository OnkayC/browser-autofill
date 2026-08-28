import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import React from 'react';
import { useTranslation } from 'react-i18next';

export interface AutofillWarningData {
  credentialOrigin?: string;
  frameOrigin?: string;
  kind: 'new-password' | 'origin-mismatch';
}

interface Props {
  data: AutofillWarningData;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function AutofillWarningDialog({ data, onCancel, onConfirm }: Props) {
  const [t] = useTranslation('global');
  const description =
    data.kind === 'origin-mismatch'
      ? t('autofill-warning.origin-mismatch', {
          credentialOrigin: data.credentialOrigin || t('autofill-warning.unknown-origin'),
          frameOrigin: data.frameOrigin || t('autofill-warning.unknown-origin')
        })
      : t('autofill-warning.new-password');

  return (
    <Dialog open fullWidth maxWidth="xs" onClose={onCancel} aria-labelledby="autofill-warning-title" aria-describedby="autofill-warning-description">
      <DialogTitle id="autofill-warning-title">{t('autofill-warning.title')}</DialogTitle>
      <DialogContent>
        <DialogContentText id="autofill-warning-description">{description}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} autoFocus>
          {t('general.cancel')}
        </Button>
        <Button color="warning" variant="contained" onClick={onConfirm}>
          {t('autofill-warning.fill-once')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
