// English dictionary — source of truth for the Dict shape.
// All other languages must conform to this structure.

export const en = {
  nav: {
    posts:   'Posts',
    create:  'Create',
    profile: 'Profile',
  },
  common: {
    back:    'Back',
    save:    'Save',
    cancel:  'Cancel',
    close:   'Close',
    done:    'Done',
    loading: 'Loading…',
  },
  language: {
    title:   'Language',
    russian: 'Русский',
    english: 'English',
  },
  profile: {
    title:               'Profile',
    currentPlan:         'Current plan',
    managePlan:          'Manage plan',
    channels:            'Channels',
    add:                 '+ Add',
    botSettings:         'Bot settings',
    botSettingsSubtitle: 'Configure Telegram bot',
    language:            'Language',
    appSettings:         'App settings',
    appSettingsSubtitle: 'Notifications, display',
    support:             'Support',
    supportSubtitle:     'Help & feedback',
    connected:           'Connected',
    default:             'Default',
    setDefault:          'Set default',
    channelStyle:        'Channel style',
    monthly:             'Monthly',
    renews:              'Renews',
    active:              'Active',
  },
  plans: {
    title:              'Plans',
    subtitle:           'Choose the plan that fits your channel workflow',
    starter:            'Starter',
    creator:            'Creator',
    studioPro:          'Studio Pro',
    active:             'Active',
    currentPlan:        'Current plan',
    switchToStarter:    'Switch to Starter',
    upgradeToCreator:   'Upgrade to Creator',
    switchToCreator:    'Switch to Creator',
    upgradeToPro:       'Upgrade to Pro',
    month:              '/ month',
    posts30:            '30 AI posts / month',
    posts150:           '150 AI posts / month',
    posts700:           '700 AI posts / month',
    channel1:           '1 channel',
    channels3:          '3 channels',
    channels10:         '10 channels',
    scheduledPosts:     'Scheduled posts',
    postPromotionSoon:  'Post promotion — soon',
    footer:             'All plans include mock data · Payments not implemented',
  },
}

// Dict is inferred without `as const` so values are `string`, not literals.
// This lets other languages satisfy the same shape with different strings.
export type Dict = typeof en
