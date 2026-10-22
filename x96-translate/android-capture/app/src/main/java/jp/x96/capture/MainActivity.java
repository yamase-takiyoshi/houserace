package jp.x96.capture;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.content.Context;
import android.graphics.Color;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

/** User-authorized media-projection recording. No DRM or capture-policy bypass. */
public class MainActivity extends Activity {
  private static final int RECORD=201, PROJECTION=202;
  private EditText address;
  private TextView status;
  private String accessToken;
  private TextView message(String text,int size){
    TextView t=new TextView(this);
    t.setText(text); t.setTextSize(size);
    t.setTextColor(Color.rgb(25,44,66)); t.setPadding(5,10,5,10);
    return t;
  }
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    LinearLayout layout=new LinearLayout(this);
    layout.setOrientation(LinearLayout.VERTICAL);
    layout.setPadding(23,19,23,15);
    layout.setBackgroundColor(Color.rgb(242,247,255));
    layout.addView(message("X96 アプリ音声取得 v0.4",24));
    layout.addView(message("Chromeや動画アプリが録音を許可している場合だけ、内部音声を翻訳サーバーへ送ります。DRMの有無とは別の制限です。",15));
    layout.addView(message("Termuxの8767サーバーが表示した127.0.0.1のURL全文を入力してください。",14));
    address=new EditText(this);
    address.setSingleLine(true);
    address.setText(getPreferences(MODE_PRIVATE).getString("address","http://127.0.0.1:8767/?token="));
    address.setSelectAllOnFocus(true);
    address.setTextColor(Color.BLACK);
    layout.addView(address);
    Button start=new Button(this);
    start.setText("▶ アプリ音声の取得を開始");
    layout.addView(start);
    Button stop=new Button(this);
    stop.setText("■ 音声取得を停止");
    layout.addView(stop);
    status=message("待機中です。開始後にAndroidの画面収録許可が表示されます。",15);
    layout.addView(status);
    layout.addView(message("開始後は対象動画アプリに切り替えて再生してください。録音中はAndroid通知から停止できます。動画映像は録画しません。",14));
    setContentView(layout);
    start.setOnClickListener(v->begin());
    stop.setOnClickListener(v->{
      Intent i=new Intent(this,CaptureService.class);i.setAction(CaptureService.STOP);
      startService(i);status.setText("停止を要求しました");
    });
  }
  private void begin(){
    Uri uri=Uri.parse(address.getText().toString().trim());
    String h=uri.getHost();
    if (!"http".equals(uri.getScheme()) || h==null ||
         !(h.equals("127.0.0.1") || h.equals("localhost")) || uri.getPort()!=8767) {
      status.setText("X96本体の http://127.0.0.1:8767/?token=... を指定してください。");
      return;
    }
    accessToken=uri.getQueryParameter("token");
    if(accessToken==null||accessToken.length()<20){
      status.setText("tokenがありません。起動時のURL全文を貼り付けてください。");return;
    }
    getPreferences(MODE_PRIVATE).edit().putString("address",address.getText().toString().trim()).apply();
    if(Build.VERSION.SDK_INT<29){status.setText("Android 10以上が必要です");return;}
    if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){
      requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},RECORD);return;
    }
    requestProjection();
  }
  @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] results){
    super.onRequestPermissionsResult(requestCode,permissions,results);
    if(requestCode!=RECORD)return;
    if(results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED)requestProjection();
    else status.setText("録音許可を有効にしてください");
  }
  private void requestProjection(){
    MediaProjectionManager mgr=(MediaProjectionManager)getSystemService(Context.MEDIA_PROJECTION_SERVICE);
    startActivityForResult(mgr.createScreenCaptureIntent(),PROJECTION);
  }
  @Override protected void onActivityResult(int req,int result,Intent data){
    super.onActivityResult(req,result,data);
    if(req!=PROJECTION)return;
    if(result!=RESULT_OK||data==null){
      status.setText("画面収録の許可がキャンセルされました");return;
    }
    Intent service=new Intent(this,CaptureService.class);
    service.setAction(CaptureService.START);
    service.putExtra("resultCode",result);
    service.putExtra("projectionData",data);
    service.putExtra("token",accessToken);
    startForegroundService(service);
    status.setText("開始を要求しました。通知を確認して対象アプリを再生してください。");
  }
}
