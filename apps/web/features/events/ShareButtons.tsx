'use client';

import { CopyOutlined, FacebookFilled, ShareAltOutlined } from '@ant-design/icons';
import { App, Button, Flex } from 'antd';
import { useClientValue } from '@/hooks/useClientValue';

export function ShareButtons({ title, path }: { title: string; path: string }) {
  const { message } = App.useApp();
  // false on the server and during hydration, the real value afterwards.
  const canNativeShare = useClientValue(() => 'share' in navigator, false);
  const url = () => (typeof window === 'undefined' ? path : `${window.location.origin}${path}`);
  const open = (href: string) => window.open(href, '_blank', 'noopener,noreferrer,width=600,height=500');

  return (
    <Flex gap={8} wrap>
      <Button icon={<FacebookFilled />} onClick={() => open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url())}`)}>
        Facebook
      </Button>
      <Button onClick={() => open(`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url())}`)}>LINE</Button>
      <Button
        icon={<CopyOutlined />}
        onClick={async () => {
          await navigator.clipboard.writeText(url());
          message.success('คัดลอกลิงก์แล้ว');
        }}
      >
        คัดลอกลิงก์
      </Button>
      {canNativeShare && (
        <Button icon={<ShareAltOutlined />} onClick={() => navigator.share({ title, url: url() }).catch(() => undefined)} />
      )}
    </Flex>
  );
}
