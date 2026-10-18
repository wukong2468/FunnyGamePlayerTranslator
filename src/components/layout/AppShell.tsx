import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Snackbar,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import TranslateIcon from '@mui/icons-material/Translate';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { startJobsPolling, useJobsStore } from '@/store/useJobsStore';
import { useAppStore } from '@/store/useAppStore';
import type { Route } from '@/types';
import { pickJsonFile } from '@/utils/fileDialog';
import { formatNumber, formatPercent } from '@/utils/format';

import GlossaryPage from '@/pages/GlossaryPage';
import ProjectConfigPage from '@/pages/ProjectConfigPage';
import SettingsPage from '@/pages/SettingsPage';
import TranslationPage from '@/pages/TranslationPage';
import WelcomePage from '@/pages/WelcomePage';

const DRAWER_WIDTH = 248;

interface NavItem {
  route: Route;
  label: string;
  icon: ReactNode;
  requiresProject: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { route: 'welcome', label: '欢迎 / 打开文件', icon: <HomeOutlinedIcon />, requiresProject: false },
  { route: 'config', label: '翻译配置', icon: <TuneOutlinedIcon />, requiresProject: true },
  { route: 'glossary', label: '术语表收集', icon: <MenuBookOutlinedIcon />, requiresProject: true },
  { route: 'translate', label: '翻译任务', icon: <TranslateIcon />, requiresProject: true },
];

const PAGE_TITLES: Record<Route, string> = {
  welcome: '欢迎使用',
  config: '翻译配置',
  glossary: '术语表收集',
  translate: '翻译任务',
  settings: '全局设置',
};

export function AppShell() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);

  const route = useAppStore((state) => state.route);
  const summary = useAppStore((state) => state.summary);
  const notify = useAppStore((state) => state.notify);
  const navigate = useAppStore((state) => state.navigate);
  const openProject = useAppStore((state) => state.openProject);
  const opening = useAppStore((state) => state.opening);
  const snackbar = useAppStore((state) => state.snackbar);
  const dismissSnackbar = useAppStore((state) => state.dismissSnackbar);

  const snapshots = useJobsStore((state) => state.snapshots);
  const fetchJobs = useJobsStore((state) => state.fetch);

  useEffect(() => startJobsPolling(), []);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [route]);

  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs, summary?.sourcePath]);

  const percent = useMemo(() => {
    if (!summary) {
      return 0;
    }
    return formatPercent(summary.doneCount, summary.itemCount);
  }, [summary]);

  const running = snapshots
    ? (['translate', 'glossary'] as const).filter((kind) => snapshots[kind].phase === 'running')
    : [];

  const handlePickFile = async () => {
    try {
      const picked = await pickJsonFile('选择 FunnyGameTranslations.json');
      if (!picked) {
        return;
      }
      const ok = await openProject({ path: picked.path, text: picked.text });
      if (ok) {
        setDrawerOpen(false);
      }
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '打开文件失败');
    }
  };

  const renderPage = () => {
    switch (route) {
      case 'welcome':
        return <WelcomePage />;
      case 'config':
        return summary ? <ProjectConfigPage /> : <WelcomePage />;
      case 'glossary':
        return summary ? <GlossaryPage /> : <WelcomePage />;
      case 'translate':
        return summary ? <TranslationPage /> : <WelcomePage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <WelcomePage />;
    }
  };

  const navList = (
    <>
      <Box sx={{ px: 2, py: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Avatar
          variant="rounded"
          sx={{
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            width: 36,
            height: 36,
            fontWeight: 700,
            borderRadius: 2,
          }}
        >
          译
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap sx={{ fontWeight: 700 }}>
            FunnyGamePlayer
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            文本翻译工具
          </Typography>
        </Box>
      </Box>
      <Divider />
      <List sx={{ pt: 1 }}>
        {NAV_ITEMS.map((item) => {
          const disabled = item.requiresProject && !summary;
          return (
            <Tooltip
              key={item.route}
              title={disabled ? '请先打开 FunnyGameTranslations.json' : ''}
              placement="right"
            >
              <span>
                <ListItemButton
                  selected={route === item.route}
                  disabled={disabled}
                  onClick={() => {
                    navigate(item.route);
                    setDrawerOpen(false);
                  }}
                >
                  <ListItemIcon sx={{ color: route === item.route ? 'primary.main' : 'inherit' }}>
                    {item.icon}
                  </ListItemIcon>
                  <ListItemText primary={item.label} />
                  {item.route === 'translate' &&
                    snapshots?.translate.phase === 'running' && (
                      <Chip size="small" color="info" label="执行中" />
                    )}
                  {item.route === 'glossary' &&
                    snapshots?.glossary.phase === 'running' && (
                      <Chip size="small" color="info" label="执行中" />
                    )}
                </ListItemButton>
              </span>
            </Tooltip>
          );
        })}
      </List>
      <Box sx={{ flex: 1 }} />
      <Divider />
      <List sx={{ py: 1 }}>
        <ListItemButton selected={route === 'settings'} onClick={() => navigate('settings')}>
          <ListItemIcon>
            <SettingsOutlinedIcon />
          </ListItemIcon>
          <ListItemText primary="全局设置" />
        </ListItemButton>
      </List>
    </>
  );

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {isMobile ? (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH, display: 'flex' } }}
        >
          {navList}
        </Drawer>
      ) : (
        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              boxSizing: 'border-box',
              display: 'flex',
              borderRight: 1,
              borderColor: 'divider',
            },
          }}
        >
          {navList}
        </Drawer>
      )}

      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <AppBar
          position="static"
          color="inherit"
          elevation={0}
          sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
        >
          <Toolbar sx={{ gap: 1.5, minHeight: { xs: 58, md: 64 } }}>
            {isMobile && (
              <IconButton
                aria-label="打开导航菜单"
                onClick={() => setDrawerOpen(true)}
                edge="start"
              >
                <MenuIcon />
              </IconButton>
            )}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700 }}>
                {PAGE_TITLES[route]}
              </Typography>
              {summary ? (
                <Typography variant="caption" color="text.secondary" noWrap display="block">
                  {summary.fileName} · 已翻译 {formatNumber(summary.doneCount)} /{' '}
                  {formatNumber(summary.itemCount)} 条
                </Typography>
              ) : (
                <Typography variant="caption" color="text.secondary" noWrap display="block">
                  尚未打开项目
                </Typography>
              )}
            </Box>
            {running.length > 0 && (
              <Chip
                color="info"
                variant="outlined"
                label={running.includes('translate') ? '翻译任务执行中' : '术语收集执行中'}
              />
            )}
            {summary && (
              <Chip
                variant="outlined"
                color={percent >= 100 ? 'success' : 'default'}
                label={`${percent}%`}
                sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
              />
            )}
            <Button
              variant={summary ? 'outlined' : 'contained'}
              startIcon={<FolderOpenOutlinedIcon />}
              onClick={handlePickFile}
              disabled={opening}
              sx={{ whiteSpace: 'nowrap' }}
            >
              {opening ? '正在打开…' : summary ? '更换文件' : '打开文件'}
            </Button>
          </Toolbar>
          {summary && (
            <LinearProgress variant="determinate" value={percent} sx={{ height: 2 }} />
          )}
        </AppBar>

        <Box
          component="main"
          ref={mainRef}
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            bgcolor: 'background.default',
            p: { xs: 2, md: 3 },
          }}
        >
          <Box sx={{ maxWidth: 1480, mx: 'auto' }}>{renderPage()}</Box>
        </Box>
      </Box>

      <Snackbar
        key={snackbar?.id}
        open={Boolean(snackbar)}
        autoHideDuration={snackbar?.severity === 'error' ? 8000 : 4500}
        onClose={dismissSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity={snackbar?.severity ?? 'info'}
          variant="filled"
          onClose={dismissSnackbar}
          sx={{ maxWidth: 520, whiteSpace: 'pre-wrap' }}
        >
          {snackbar?.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
