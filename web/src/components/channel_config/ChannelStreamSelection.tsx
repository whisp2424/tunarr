import { getApiStreamSelectionProfilesOptions } from '@/generated/@tanstack/react-query.gen.ts';
import {
  postApiStreamSelectionProfiles,
  postApiStreamSelectionProfilesValidateExpression,
  putApiStreamSelectionProfilesById,
} from '@/generated/sdk.gen.ts';
import { useChannelFormContext } from '@/hooks/useChannelFormContext.ts';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  StreamSelectionProfile,
  StreamSelectionRule,
} from '@tunarr/types/schemas';
import { useState } from 'react';
import { Controller } from 'react-hook-form';

type RuleDraft = {
  label: string;
  condition: string;
  audioType: StreamSelectionRule['audioAction']['type'];
  audioLanguages: string;
  audioTitle: string;
  preferChannels: '' | 'most' | 'least';
  subtitleType: StreamSelectionRule['subtitleAction']['type'];
  subtitleLanguages: string;
  filterType: Extract<
    StreamSelectionRule['subtitleAction'],
    { type: 'by_language' }
  >['filterType'];
  filterOrder: ('forced' | 'default')[];
  allowExternal: boolean;
  allowImageBased: boolean;
};

const emptyRule = (): RuleDraft => ({
  label: '',
  condition: 'true',
  audioType: 'default',
  audioLanguages: '',
  audioTitle: '',
  preferChannels: '',
  subtitleType: 'disable',
  subtitleLanguages: '',
  filterType: 'any',
  filterOrder: [],
  allowExternal: true,
  allowImageBased: true,
});

function toDraft(rule: StreamSelectionRule): RuleDraft {
  return {
    ...emptyRule(),
    label: rule.label ?? '',
    condition: rule.condition,
    audioType: rule.audioAction.type,
    audioLanguages:
      rule.audioAction.type === 'by_language'
        ? rule.audioAction.languages.join(', ')
        : '',
    audioTitle:
      rule.audioAction.type === 'by_title'
        ? rule.audioAction.titleContains
        : '',
    preferChannels:
      rule.audioAction.type === 'by_language'
        ? (rule.audioAction.preferChannels ?? '')
        : '',
    subtitleType: rule.subtitleAction.type,
    subtitleLanguages:
      rule.subtitleAction.type === 'by_language'
        ? rule.subtitleAction.languages.join(', ')
        : '',
    filterType:
      rule.subtitleAction.type === 'by_language'
        ? (rule.subtitleAction.filterOrder?.[0] ??
          rule.subtitleAction.filterType)
        : 'any',
    filterOrder:
      rule.subtitleAction.type === 'by_language'
        ? (rule.subtitleAction.filterOrder ??
          (rule.subtitleAction.filterType === 'forced' ||
          rule.subtitleAction.filterType === 'default'
            ? [rule.subtitleAction.filterType]
            : []))
        : [],
    allowExternal:
      rule.subtitleAction.type === 'by_language'
        ? rule.subtitleAction.allowExternal
        : true,
    allowImageBased:
      rule.subtitleAction.type === 'by_language'
        ? rule.subtitleAction.allowImageBased
        : true,
  };
}

function toRule(rule: RuleDraft): StreamSelectionRule {
  const languages = (input: string) =>
    input
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return {
    label: rule.label.trim() || undefined,
    condition: rule.condition.trim(),
    audioAction:
      rule.audioType === 'by_language'
        ? {
            type: 'by_language',
            languages: languages(rule.audioLanguages),
            preferChannels: rule.preferChannels || undefined,
          }
        : rule.audioType === 'by_title'
          ? { type: 'by_title', titleContains: rule.audioTitle.trim() }
          : { type: 'default' },
    subtitleAction:
      rule.subtitleType === 'by_language'
        ? {
            type: 'by_language',
            languages: languages(rule.subtitleLanguages),
            filterType: rule.filterType,
            filterOrder:
              rule.filterOrder.length > 1 ? rule.filterOrder : undefined,
            allowExternal: rule.allowExternal,
            allowImageBased: rule.allowImageBased,
          }
        : { type: rule.subtitleType },
  };
}

export function ChannelStreamSelection() {
  const { control, setValue, watch } = useChannelFormContext();
  const selectedId = watch('streamSelectionProfileId');
  const queryClient = useQueryClient();
  const profilesQuery = useQuery(getApiStreamSelectionProfilesOptions());
  const profiles = profilesQuery.data ?? [];
  const selected = profiles.find((profile) => profile.uuid === selectedId);
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [rules, setRules] = useState<RuleDraft[]>([emptyRule()]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function openEditor(profile?: StreamSelectionProfile) {
    setEditingId(profile?.uuid ?? null);
    setName(profile?.name ?? '');
    setRules(profile?.rules.map(toDraft) ?? [emptyRule()]);
    setError('');
    setEditing(true);
  }

  function changeRule(index: number, change: Partial<RuleDraft>) {
    setRules((current) =>
      current.map((rule, i) => (i === index ? { ...rule, ...change } : rule)),
    );
  }

  function moveRule(index: number, direction: -1 | 1) {
    setRules((current) => {
      const next = [...current];
      const other = index + direction;
      const item = next[index];
      const swap = next[other];
      if (item && swap) {
        next[index] = swap;
        next[other] = item;
      }
      return next;
    });
  }

  async function saveProfile() {
    const parsedRules = rules.map(toRule);
    if (
      !name.trim() ||
      parsedRules.some(
        (rule) =>
          !rule.condition ||
          (rule.audioAction.type === 'by_language' &&
            !rule.audioAction.languages.length) ||
          (rule.audioAction.type === 'by_title' &&
            !rule.audioAction.titleContains) ||
          (rule.subtitleAction.type === 'by_language' &&
            !rule.subtitleAction.languages.length),
      )
    ) {
      setError(
        'Enter a profile name, a condition for each rule, and the requested languages or title.',
      );
      return;
    }
    setSaving(true);
    setError('');
    try {
      for (let i = 0; i < parsedRules.length; i++) {
        const rule = parsedRules[i];
        if (!rule) continue;
        const validation =
          await postApiStreamSelectionProfilesValidateExpression({
            body: { expression: rule.condition },
          });
        if (validation.error || !validation.data?.valid) {
          setError(
            `Rule ${i + 1}: ${validation.error?.error ?? 'The condition could not be validated.'}`,
          );
          return;
        }
      }
      const body = { name: name.trim(), rules: parsedRules };
      const result = editingId
        ? await putApiStreamSelectionProfilesById({
            path: { id: editingId },
            body,
            throwOnError: true,
          })
        : await postApiStreamSelectionProfiles({ body, throwOnError: true });
      await queryClient.invalidateQueries({
        queryKey: getApiStreamSelectionProfilesOptions().queryKey,
      });
      setValue('streamSelectionProfileId', result.data.uuid, {
        shouldDirty: true,
      });
      setEditing(false);
    } catch {
      setError(
        'Could not save the profile. Check the server connection and try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack spacing={1} sx={{ my: 2 }}>
      <FormControl fullWidth>
        <InputLabel id="track-profile-label">
          Track selection profile
        </InputLabel>
        <Controller
          control={control}
          name="streamSelectionProfileId"
          render={({ field }) => (
            <Select
              labelId="track-profile-label"
              label="Track selection profile"
              value={field.value ?? ''}
              onChange={(event) => field.onChange(event.target.value || null)}
              onBlur={field.onBlur}
              inputRef={field.ref}
            >
              <MenuItem value="">Use channel and global preferences</MenuItem>
              {profiles.map((profile) => (
                <MenuItem key={profile.uuid} value={profile.uuid}>
                  {profile.name}
                </MenuItem>
              ))}
            </Select>
          )}
        />
        <FormHelperText>
          Profiles apply to transcoded streams and the ErsatzTV backend.
          Passthrough streams use their existing track behavior. Enable
          subtitles below to show selected subtitles. Save the channel to apply
          its selected profile.
        </FormHelperText>
      </FormControl>
      {profilesQuery.isError && (
        <Alert severity="error">Could not load track selection profiles.</Alert>
      )}
      <Stack direction="row" spacing={1}>
        <Button type="button" variant="outlined" onClick={() => openEditor()}>
          New profile
        </Button>
        <Button
          type="button"
          disabled={!selected}
          onClick={() => selected && openEditor(selected)}
        >
          Edit profile
        </Button>
      </Stack>
      <Dialog
        open={editing}
        onClose={() => !saving && setEditing(false)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>
          {editingId
            ? 'Edit track selection profile'
            : 'New track selection profile'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2">
              Rules run in order. The first true condition selects the actions,
              even if a requested track is unavailable. If no rule matches, the
              first audio track is used and subtitles are disabled. Saving a
              profile applies its changes immediately. Save the channel
              separately to assign the profile to it.
            </Typography>
            {editingId && (
              <Alert severity="info">
                Changes to this profile affect every channel, filler list, or
                program that uses it.
              </Alert>
            )}
            <TextField
              label="Profile name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              fullWidth
            />
            {rules.map((rule, index) => (
              <Stack
                key={index}
                spacing={2}
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  p: 2,
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography variant="h6" sx={{ flexGrow: 1 }}>
                    Rule {index + 1}
                  </Typography>
                  <Button
                    type="button"
                    disabled={index === 0}
                    onClick={() => moveRule(index, -1)}
                  >
                    Up
                  </Button>
                  <Button
                    type="button"
                    disabled={index === rules.length - 1}
                    onClick={() => moveRule(index, 1)}
                  >
                    Down
                  </Button>
                  <Button
                    type="button"
                    disabled={rules.length === 1}
                    onClick={() =>
                      setRules(rules.filter((_, i) => i !== index))
                    }
                  >
                    Remove
                  </Button>
                </Stack>
                <TextField
                  label="Rule label (optional)"
                  value={rule.label}
                  onChange={(event) =>
                    changeRule(index, { label: event.target.value })
                  }
                />
                <TextField
                  label="Condition (CEL)"
                  value={rule.condition}
                  onChange={(event) =>
                    changeRule(index, { condition: event.target.value })
                  }
                  helperText={
                    'Use true to always match, or an expression such as hasAudioLang("jpn").'
                  }
                />
                <TextField
                  select
                  label="Audio"
                  value={rule.audioType}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (
                      value === 'default' ||
                      value === 'by_language' ||
                      value === 'by_title'
                    )
                      changeRule(index, { audioType: value });
                  }}
                >
                  <MenuItem value="default">Default audio</MenuItem>
                  <MenuItem value="by_language">Preferred languages</MenuItem>
                  <MenuItem value="by_title">Title contains</MenuItem>
                </TextField>
                {rule.audioType === 'by_language' && (
                  <>
                    <TextField
                      label="Audio languages"
                      value={rule.audioLanguages}
                      onChange={(event) =>
                        changeRule(index, {
                          audioLanguages: event.target.value,
                        })
                      }
                      helperText="Comma-separated language codes in preference order, for example jpn, eng. Falls back to default audio when none match."
                    />
                    <TextField
                      select
                      label="Prefer channel count"
                      value={rule.preferChannels}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (
                          value === '' ||
                          value === 'most' ||
                          value === 'least'
                        )
                          changeRule(index, { preferChannels: value });
                      }}
                    >
                      <MenuItem value="">First match</MenuItem>
                      <MenuItem value="most">Most channels</MenuItem>
                      <MenuItem value="least">Fewest channels</MenuItem>
                    </TextField>
                  </>
                )}
                {rule.audioType === 'by_title' && (
                  <TextField
                    label="Audio title contains"
                    value={rule.audioTitle}
                    onChange={(event) =>
                      changeRule(index, { audioTitle: event.target.value })
                    }
                    helperText="Case-insensitive. Falls back to default audio when no title matches."
                  />
                )}
                <TextField
                  select
                  label="Subtitles"
                  value={rule.subtitleType}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (
                      value === 'disable' ||
                      value === 'default' ||
                      value === 'by_language'
                    )
                      changeRule(index, { subtitleType: value });
                  }}
                >
                  <MenuItem value="disable">Disabled</MenuItem>
                  <MenuItem value="default">Default subtitle</MenuItem>
                  <MenuItem value="by_language">Preferred languages</MenuItem>
                </TextField>
                {rule.subtitleType === 'by_language' && (
                  <>
                    <TextField
                      label="Subtitle languages"
                      value={rule.subtitleLanguages}
                      onChange={(event) =>
                        changeRule(index, {
                          subtitleLanguages: event.target.value,
                        })
                      }
                      helperText="Comma-separated language codes in preference order. No match disables subtitles."
                    />
                    <TextField
                      select
                      label="Subtitle filter"
                      value={
                        rule.filterOrder.length > 1
                          ? 'ordered'
                          : rule.filterType
                      }
                      onChange={(event) => {
                        const value = event.target.value;
                        if (
                          value === 'any' ||
                          value === 'not_forced' ||
                          value === 'forced' ||
                          value === 'default' ||
                          value === 'none'
                        ) {
                          changeRule(index, {
                            filterType: value,
                            filterOrder: [],
                          });
                        }
                      }}
                      helperText="Any except forced includes tracks regardless of their default flag."
                    >
                      {rule.filterOrder.length > 1 && (
                        <MenuItem value="ordered">
                          {rule.filterOrder
                            .map((filter) =>
                              filter === 'forced' ? 'Forced' : 'Default',
                            )
                            .join(' then ')}{' '}
                          (existing order)
                        </MenuItem>
                      )}
                      <MenuItem value="any">Any</MenuItem>
                      <MenuItem value="not_forced">Any except forced</MenuItem>
                      <MenuItem value="forced">Forced only</MenuItem>
                      <MenuItem value="default">Default only</MenuItem>
                      <MenuItem value="none">None</MenuItem>
                    </TextField>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={rule.allowExternal}
                          onChange={(_, checked) =>
                            changeRule(index, { allowExternal: checked })
                          }
                        />
                      }
                      label="Allow external subtitles"
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={rule.allowImageBased}
                          onChange={(_, checked) =>
                            changeRule(index, { allowImageBased: checked })
                          }
                        />
                      }
                      label="Allow image-based subtitles"
                    />
                  </>
                )}
              </Stack>
            ))}
            <Button
              type="button"
              onClick={() => setRules([...rules, emptyRule()])}
            >
              Add rule
            </Button>
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            type="button"
            disabled={saving}
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="contained"
            disabled={saving}
            onClick={() => void saveProfile()}
          >
            Save profile
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
