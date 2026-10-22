package jp.x96.capture;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.IBinder;
import android.util.Log;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.security.SecureRandom;
import java.util.Locale;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;

/** Captures only opt-in, playback-capturable application audio on Android 10+. */
public class CaptureService extends Service {
  static final String START="jp.x96.capture.START", STOP="jp.x96.capture.STOP";
  private static final int RATE=16000, BLOCK=RATE*2*12;
  private volatile boolean running=false;
  private MediaProjection projection;
  private AudioRecord recorder;
  private Thread sender;
  private String token,session;
  private final ArrayBlockingQueue<Chunk> outgoing=new ArrayBlockingQueue<>(3);
  private static class Chunk {
    final int sequence;final byte[] wave;
    Chunk(int id,byte[] bytes){sequence=id;wave=bytes;}
  }
  @Override public IBinder onBind(Intent intent){return null;}
  @Override public int onStartCommand(Intent intent,int flags,int startId){
    if(intent==null)return START_NOT_STICKY;
    if(STOP.equals(intent.getAction())){running=false;stopSelf();return START_NOT_STICKY;}
    if(!START.equals(intent.getAction())||running)return START_NOT_STICKY;
    token=intent.getStringExtra("token");
    Intent permission=(Intent)intent.getParcelableExtra("projectionData");
    if(token==null||permission==null){stopSelf();return START_NOT_STICKY;}
    try{
      foreground();
    }catch(Exception e){
      Log.e("X96Capture","Foreground service failed",e);
      stopSelf();return START_NOT_STICKY;
    }
    running=true;
    int result=intent.getIntExtra("resultCode",0);
    new Thread(()->capture(result,permission),"X96AudioRecorder").start();
    return START_NOT_STICKY;
  }
  private void foreground(){
    NotificationManager nm=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
    String channel="x96_capture";
    nm.createNotificationChannel(new NotificationChannel(channel,"X96 動画アプリ音声",NotificationManager.IMPORTANCE_LOW));
    Intent stop=new Intent(this,CaptureService.class); stop.setAction(STOP);
    PendingIntent action=PendingIntent.getService(this,1,stop,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    Notification n=new Notification.Builder(this,channel)
       .setSmallIcon(android.R.drawable.ic_btn_speak_now)
       .setContentTitle("X96 アプリ音声を取得中")
       .setContentText("画面収録許可済みのアプリ音声を翻訳サーバーに送信")
       .setOngoing(true)
       .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_pause,"停止",action).build())
       .build();
    startForeground(8,n);
  }
  private void capture(int permissionResult,Intent permissionIntent){
    try{
      MediaProjectionManager manager=(MediaProjectionManager)getSystemService(Context.MEDIA_PROJECTION_SERVICE);
      projection=manager.getMediaProjection(permissionResult,permissionIntent);
      if(projection==null)throw new IllegalStateException("MediaProjection not authorized");
      projection.registerCallback(new MediaProjection.Callback(){
        @Override public void onStop(){running=false;stopSelf();}
      },null);
      AudioPlaybackCaptureConfiguration config=new AudioPlaybackCaptureConfiguration.Builder(projection)
        .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
        .addMatchingUsage(AudioAttributes.USAGE_GAME)
        .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN).build();
      AudioFormat format=new AudioFormat.Builder()
        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
        .setSampleRate(RATE)
        .setChannelMask(AudioFormat.CHANNEL_IN_MONO).build();
      int min=AudioRecord.getMinBufferSize(RATE,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);
      recorder=new AudioRecord.Builder()
        .setAudioFormat(format)
        .setBufferSizeInBytes(Math.max(min*4,65536))
        .setAudioPlaybackCaptureConfig(config).build();
      if(recorder.getState()!=AudioRecord.STATE_INITIALIZED)throw new IllegalStateException("AudioRecord init failed");
      byte[] random=new byte[16];new SecureRandom().nextBytes(random);
      StringBuilder sb=new StringBuilder();
      for(byte b:random)sb.append(String.format(Locale.US,"%02x",b&255));
      session=sb.toString();
      request("/api/live/start",("{\"session\":\""+session+"\"}").getBytes("UTF-8"),"application/json",-1);
      sender=new Thread(this::senderLoop,"X96AudioSender");
      sender.start();
      recorder.startRecording();
      byte[] pcm=new byte[BLOCK];
      int seq=0;
      while(running){
        int used=0;long sumSquares=0;
        while(running&&used<BLOCK){
          int n=recorder.read(pcm,used,Math.min(8192,BLOCK-used),AudioRecord.READ_BLOCKING);
          if(n<0)throw new IllegalStateException("AudioRecord read "+n);
          if(n==0)continue;
          for(int j=used;j+1<used+n;j+=2){
            short sample=(short)((pcm[j]&255)|(pcm[j+1]<<8));
            sumSquares+=(long)sample*sample;
          }
          used+=n;
        }
        if(!running||used==0)break;
        // Silent chunks are not uploaded. The sequence still advances to preserve elapsed time.
        if(sumSquares/Math.max(1,used/2)>70L*70L){
          if(!outgoing.offer(new Chunk(seq,wav(pcm,used)))){
            Log.w("X96Capture","X96 is too slow: dropping chunk");
          }
        }
        seq++;
      }
    }catch(Throwable e){
      Log.e("X96Capture","Capture failed: "+e.getClass().getSimpleName()+" "+e.getMessage(),e);
    }finally{running=false;stopSelf();}
  }
  private void senderLoop(){
    while(running||!outgoing.isEmpty()){
      try{
        Chunk chunk=outgoing.poll(700,TimeUnit.MILLISECONDS);
        if(chunk!=null)request("/api/live/chunk",chunk.wave,"audio/wav",chunk.sequence);
      }catch(Exception ex){Log.w("X96Capture","Send failed: "+ex.getMessage());}
    }
  }
  private static byte[] wav(byte[] pcm,int count){
    ByteBuffer header=ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
    header.put(new byte[]{'R','I','F','F'}).putInt(count+36);
    header.put(new byte[]{'W','A','V','E'});
    header.put(new byte[]{'f','m','t',' '});
    header.putInt(16).putShort((short)1).putShort((short)1);
    header.putInt(RATE).putInt(RATE*2).putShort((short)2).putShort((short)16);
    header.put(new byte[]{'d','a','t','a'}).putInt(count);
    byte[] data=new byte[44+count];
    System.arraycopy(header.array(),0,data,0,44);
    System.arraycopy(pcm,0,data,44,count);
    return data;
  }
  private void request(String endpoint,byte[] data,String contentType,int sequence)throws Exception {
    HttpURLConnection c=(HttpURLConnection)new URL("http://127.0.0.1:8767"+endpoint).openConnection();
    c.setConnectTimeout(3000); c.setReadTimeout(8000);
    c.setRequestMethod("POST"); c.setDoOutput(true);
    c.setRequestProperty("Authorization","Bearer "+token);
    c.setRequestProperty("Content-Type",contentType);
    if(sequence>=0){
      c.setRequestProperty("X-Capture-Session",session);
      c.setRequestProperty("X-Capture-Sequence",String.valueOf(sequence));
    }
    c.setFixedLengthStreamingMode(data.length);
    try(OutputStream o=c.getOutputStream()){o.write(data);}
    int code=c.getResponseCode();c.disconnect();
    if(code<200||code>=300)throw new IllegalStateException("HTTP "+code);
  }
  @Override public void onDestroy(){
    running=false;
    if(recorder!=null){
      try{recorder.stop();}catch(Exception ignored){}
      try{recorder.release();}catch(Exception ignored){}
      recorder=null;
    }
    if(projection!=null){
      MediaProjection m=projection;projection=null;
      try{m.stop();}catch(Exception ignored){}
    }
    new Thread(()->{
      try{if(session!=null)request("/api/live/stop","{}".getBytes("UTF-8"),"application/json",-1);}
      catch(Exception ignored){}
    }).start();
    super.onDestroy();
  }
}
